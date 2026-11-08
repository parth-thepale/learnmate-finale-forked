import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { classifyGeminiError } from '../src/utils/stabilityEngine.ts';
import { validateAndSanitizeTutorAnswer } from '../src/server/tutorEngine.ts';

async function verifyGeminiProduction() {
  console.log('=== VERIFYING GEMINI PRODUCTION CONNECTIVITY & CAPABILITIES ===\n');

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const isKeyConfigured = Boolean(
    apiKey &&
    apiKey !== 'MY_GEMINI_API_KEY' &&
    apiKey !== 'YOUR_ACTUAL_GEMINI_API_KEY' &&
    apiKey.length > 20
  );

  console.log(`1. API Key Configured: ${isKeyConfigured ? 'YES (Masked: ' + apiKey.slice(0, 4) + '...' + apiKey.slice(-4) + ')' : 'NO'}`);

  if (!isKeyConfigured) {
    console.error('Fatal: GEMINI_API_KEY is not configured in .env');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelsToTest = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  console.log(`2. Models to Test: ${modelsToTest.join(', ')}\n`);

  // List available models to check what is supported on this key
  try {
    console.log('Querying available models on this API key...');
    const pager = await ai.models.list();
    const modelIds: string[] = [];
    for await (const m of pager) {
      if (m.name) modelIds.push(m.name.replace(/^models\//, ''));
    }
    console.log(`Found ${modelIds.length} models. Relevant Flash models:`, modelIds.filter(m => m.includes('flash')).slice(0, 10));
  } catch (err: any) {
    console.log('Could not list models:', err?.message || err);
  }

  for (const modelName of modelsToTest) {
    console.log(`--- Testing Model: ${modelName} ---`);
    const startTime = Date.now();
    let tutorResponseText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      console.log(`   Sending live prompt to ${modelName}...`);
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: "State Newton's Second Law of Motion in vector form and define 1 Newton in SI units. Be concise and rigorous." }],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Call timed out after 12000ms')), 12000)
      );

      const result = await Promise.race([callPromise, timeoutPromise]);

      const elapsed = Date.now() - startTime;
      tutorResponseText = result.text || '';
      inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;

      console.log(`   ✓ ${modelName} succeeded in ${elapsed}ms`);
      console.log(`   ✓ Token usage: ${inputTokens} input, ${outputTokens} output`);
      console.log(`   ✓ Excerpt: "${tutorResponseText.slice(0, 120).replace(/\n/g, ' ')}..."`);

      const validation = validateAndSanitizeTutorAnswer(tutorResponseText, 'physics');
      console.log(`   ✓ Content validation: ${validation.valid ? 'CLEAN (PASS)' : 'FLAGGED: ' + validation.detectedIssues.join(', ')}\n`);
    } catch (err: any) {
      const classified = classifyGeminiError(err);
      console.error(`   ✗ ${modelName} call failed: [${classified.category}] ${classified.userMessage} (Raw: ${err?.status || err?.statusCode || ''} ${err?.message || err})\n`);
    }
  }

  // 5. Honest Error Classification & Quota Failure Handling test
  console.log('5. Testing honest failure diagnosis (invalid model)...');
  try {
    await ai.models.generateContent({
      model: 'non-existent-test-model-xyz-999',
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
    });
    console.error('   Expected failure, but call succeeded!');
  } catch (err) {
    const classified = classifyGeminiError(err);
    console.log(`   ✓ Correctly caught and classified error:`);
    console.log(`     - Category: ${classified.category}`);
    console.log(`     - Status Code: ${classified.statusCode}`);
    console.log(`     - User Message: ${classified.userMessage}`);
  }

  console.log('\n=== GEMINI VERIFICATION COMPLETE ===\n');
}

verifyGeminiProduction().catch((err) => {
  console.error('Unhandled failure:', err);
  process.exit(1);
});
