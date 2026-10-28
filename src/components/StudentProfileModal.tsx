import React, { useState, useEffect } from 'react';
import {
  X,
  GraduationCap,
  Target,
  CheckCircle2,
  School,
  Building2,
  Globe,
  Clock,
  BookOpen
} from 'lucide-react';
import {
  StudentAcademicProfile,
  EducationStage,
  ExamTypeId
} from '../types/study';
import { studyStorage } from '../services/storageService';

interface StudentProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileSaved: (profile: StudentAcademicProfile) => void;
}

const EXAM_OPTIONS: { id: ExamTypeId; label: string; badge: string }[] = [
  { id: 'jee_main', label: 'JEE Main', badge: 'Engineering UG' },
  { id: 'jee_advanced', label: 'JEE Advanced', badge: 'IIT Entrance' },
  { id: 'neet_ug', label: 'NEET UG', badge: 'Medical UG' },
  { id: 'cuet', label: 'CUET UG / PG', badge: 'Central Universities' },
  { id: 'board_exams', label: 'Board Exams (CBSE / ICSE / State)', badge: 'Class 10 & 12' },
  { id: 'university_exams', label: 'University / College Semester Exams', badge: 'B.Tech / B.Sc / MBBS / BA' },
  { id: 'general_practice', label: 'General Practice & Concept Mastery', badge: 'Self-Paced' }
];

export const StudentProfileModal: React.FC<StudentProfileModalProps> = ({
  isOpen,
  onClose,
  onProfileSaved
}) => {
  const [profile, setProfile] = useState<StudentAcademicProfile>(() =>
    studyStorage.getStudentProfile()
  );
  const [subjectsInput, setSubjectsInput] = useState<string>('');
  const [weakAreasInput, setWeakAreasInput] = useState<string>('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const current = studyStorage.getStudentProfile();
      setProfile(current);
      setSubjectsInput(current.subjectsStudied.join(', '));
      setWeakAreasInput(current.weakAreas.join(', '));
      setSavedNotice(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isSchoolStage = profile.educationStage === 'school';

  const handleStageChange = (stage: EducationStage) => {
    setProfile((prev) => ({
      ...prev,
      educationStage: stage,
      targetExam:
        stage === 'college' && prev.targetExam === 'board_exams'
          ? 'university_exams'
          : stage === 'school' && prev.targetExam === 'university_exams'
          ? 'board_exams'
          : prev.targetExam
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSubjects = subjectsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedWeakAreas = weakAreasInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const updated: StudentAcademicProfile = {
      ...profile,
      subjectsStudied:
        parsedSubjects.length > 0 ? parsedSubjects : ['Physics', 'Mathematics', 'Chemistry'],
      weakAreas: parsedWeakAreas,
      updatedAt: new Date().toISOString()
    };

    studyStorage.saveStudentProfile(updated);
    setSavedNotice(true);
    onProfileSaved(updated);
    setTimeout(() => {
      onClose();
    }, 450);
  };

  return (
    <div
      data-testid="student-profile-modal"
      className="fixed inset-0 z-50 bg-[#121827]/45 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl border border-[#E8E6E2] shadow-2xl max-w-3xl w-full overflow-hidden my-8">
        {/* Modal Header */}
        <div className="px-6 py-5 bg-[#FCFBF9] border-b border-[#E8E6E2] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FBECE6] text-[#C84428] flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="lm-kicker">ACADEMIC PROFILE</div>
              <h2 className="font-serif-editorial text-xl font-bold text-[#121827]">
                Student Identity &amp; Exam Goals
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg text-[#606B7C] hover:text-[#121827] hover:bg-[#F7F5F0] flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="student-full-name" className="block text-xs font-semibold text-[#121827] mb-1.5">
                Full Name
              </label>
              <input
                id="student-full-name"
                type="text"
                required
                value={profile.fullName}
                onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                data-testid="profile-fullname-input"
                placeholder="e.g. Aarav Sharma"
                className="w-full h-10 px-3.5 rounded-lg border border-[#E8E6E2] text-xs font-medium text-[#121827] focus:outline-none focus:border-[#C84428]"
              />
            </div>

            <div>
              <label htmlFor="student-education-stage" className="block text-xs font-semibold text-[#121827] mb-1.5">
                Current Education Stage
              </label>
              <select
                id="student-education-stage"
                value={profile.educationStage}
                onChange={(e) => handleStageChange(e.target.value as EducationStage)}
                data-testid="profile-stage-select"
                className="w-full h-10 px-3.5 rounded-lg border border-[#E8E6E2] text-xs font-semibold text-[#121827] bg-white focus:outline-none focus:border-[#C84428]"
              >
                <option value="school">School Student (Class 9-12)</option>
                <option value="college">Undergraduate / College Student</option>
                <option value="self_learner">Self-Learner / Competitive Aspirant</option>
              </select>
            </div>
          </div>

          {/* Conditional Academic Fields: School vs College */}
          {isSchoolStage ? (
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E8E6E2] space-y-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#121827]">
                <School className="w-4 h-4 text-[#C84428]" />
                <span>School Academic Details (Class 9-12)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="profile-school-class" className="block text-xs font-medium text-[#606B7C] mb-1">
                    Class / Grade
                  </label>
                  <select
                    id="profile-school-class"
                    value={profile.schoolClass}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        schoolClass: e.target.value as StudentAcademicProfile['schoolClass']
                      })
                    }
                    data-testid="profile-school-class-select"
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  >
                    <option value="Class 9">Class 9</option>
                    <option value="Class 10">Class 10</option>
                    <option value="Class 11">Class 11</option>
                    <option value="Class 12">Class 12</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="profile-stream" className="block text-xs font-medium text-[#606B7C] mb-1">
                    Academic Stream
                  </label>
                  <select
                    id="profile-stream"
                    value={profile.stream}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        stream: e.target.value as StudentAcademicProfile['stream']
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  >
                    <option value="PCM">Science (PCM)</option>
                    <option value="PCB">Science (PCB)</option>
                    <option value="PCMB">Science (PCMB)</option>
                    <option value="Commerce">Commerce</option>
                    <option value="Arts / Humanities">Arts / Humanities</option>
                    <option value="Foundation">Foundation (Class 9/10)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="profile-board" className="block text-xs font-medium text-[#606B7C] mb-1">
                    School Board
                  </label>
                  <select
                    id="profile-board"
                    value={profile.schoolBoard}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        schoolBoard: e.target.value as StudentAcademicProfile['schoolBoard']
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  >
                    <option value="CBSE">CBSE</option>
                    <option value="ICSE / ISC">ICSE / ISC</option>
                    <option value="State Board">State Board</option>
                    <option value="IB / Cambridge">IB / Cambridge</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="profile-acad-year" className="block text-xs font-medium text-[#606B7C] mb-1">
                    Academic Year
                  </label>
                  <input
                    id="profile-acad-year"
                    type="text"
                    value={profile.academicYear}
                    onChange={(e) => setProfile({ ...profile, academicYear: e.target.value })}
                    placeholder="2026-2027"
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="profile-school-name" className="block text-xs font-medium text-[#606B7C] mb-1">
                  School Name (Optional)
                </label>
                <input
                  id="profile-school-name"
                  type="text"
                  value={profile.schoolName}
                  onChange={(e) => setProfile({ ...profile, schoolName: e.target.value })}
                  placeholder="e.g. Delhi Public School / Kendriya Vidyalaya"
                  className="w-full h-9 px-3 rounded-lg border border-[#E8E6E2] bg-white text-xs text-[#121827]"
                />
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E8E6E2] space-y-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#121827]">
                <Building2 className="w-4 h-4 text-[#C84428]" />
                <span>Undergraduate / University Details</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="profile-college-year" className="block text-xs font-medium text-[#606B7C] mb-1">
                    Year of Study
                  </label>
                  <select
                    id="profile-college-year"
                    value={profile.collegeYear}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        collegeYear: e.target.value as StudentAcademicProfile['collegeYear']
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  >
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                    <option value="Postgraduate">Postgraduate</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="profile-degree-course" className="block text-xs font-medium text-[#606B7C] mb-1">
                    Degree Program
                  </label>
                  <input
                    id="profile-degree-course"
                    type="text"
                    value={profile.degreeCourse}
                    onChange={(e) => setProfile({ ...profile, degreeCourse: e.target.value })}
                    placeholder="e.g. B.Tech Computer Science, B.Sc, MBBS"
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  />
                </div>
                <div>
                  <label htmlFor="profile-university-name" className="block text-xs font-medium text-[#606B7C] mb-1">
                    College / University
                  </label>
                  <input
                    id="profile-university-name"
                    type="text"
                    value={profile.universityName}
                    onChange={(e) => setProfile({ ...profile, universityName: e.target.value })}
                    placeholder="e.g. IIT / NIT / Delhi University"
                    className="w-full h-9 px-2.5 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Target Examination & Learning Goals */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-[#121827]">
              <Target className="w-4 h-4 text-[#C84428]" />
              <span>Target Examination &amp; Preparation Focus</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="profile-target-exam" className="block text-xs font-medium text-[#606B7C] mb-1">
                  Target Examination (Calibrates Practice Simulator)
                </label>
                <select
                  id="profile-target-exam"
                  value={profile.targetExam}
                  onChange={(e) =>
                    setProfile({ ...profile, targetExam: e.target.value as ExamTypeId })
                  }
                  data-testid="profile-target-exam-select"
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] bg-white text-xs font-bold text-[#121827]"
                >
                  {EXAM_OPTIONS.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.label} ({exam.badge})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="profile-target-year" className="block text-xs font-medium text-[#606B7C] mb-1">
                  Target Exam Year
                </label>
                <input
                  id="profile-target-year"
                  type="text"
                  value={profile.targetExamYear}
                  onChange={(e) => setProfile({ ...profile, targetExamYear: e.target.value })}
                  placeholder="2027"
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] text-xs font-bold text-[#121827]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-subjects" className="block text-xs font-medium text-[#606B7C] mb-1">
                  Subjects Studied (comma-separated)
                </label>
                <input
                  id="profile-subjects"
                  type="text"
                  value={subjectsInput}
                  onChange={(e) => setSubjectsInput(e.target.value)}
                  placeholder="Physics, Mathematics, Chemistry"
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] text-xs text-[#121827]"
                />
              </div>

              <div>
                <label htmlFor="profile-weak-areas" className="block text-xs font-medium text-[#606B7C] mb-1">
                  Weak Topics to Target (comma-separated)
                </label>
                <input
                  id="profile-weak-areas"
                  type="text"
                  value={weakAreasInput}
                  onChange={(e) => setWeakAreasInput(e.target.value)}
                  placeholder="Conditional Probability, Bayes Theorem, Integration"
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] text-xs text-[#121827]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-language" className="block text-xs font-medium text-[#606B7C] mb-1 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#606B7C]" />
                  Preferred Study Language
                </label>
                <select
                  id="profile-language"
                  value={profile.preferredLanguage}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      preferredLanguage: e.target.value as StudentAcademicProfile['preferredLanguage']
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] bg-white text-xs font-semibold text-[#121827]"
                >
                  <option value="English">English</option>
                  <option value="Hindi + English (Hinglish)">Hindi + English (Hinglish)</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Tamil">Tamil</option>
                  <option value="Telugu">Telugu</option>
                  <option value="Bengali">Bengali</option>
                </select>
              </div>

              <div>
                <label htmlFor="profile-daily-goal" className="block text-xs font-medium text-[#606B7C] mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#606B7C]" />
                  Daily Study Goal (Minutes)
                </label>
                <input
                  id="profile-daily-goal"
                  type="number"
                  min={15}
                  max={600}
                  value={profile.dailyStudyMinutesGoal}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      dailyStudyMinutesGoal: Number(e.target.value) || 90
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] text-xs font-semibold text-[#121827]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="profile-goal-statement" className="block text-xs font-medium text-[#606B7C] mb-1">
                Semester or Exam Goal Note
              </label>
              <textarea
                id="profile-goal-statement"
                rows={2}
                value={profile.personalGoalStatement}
                onChange={(e) =>
                  setProfile({ ...profile, personalGoalStatement: e.target.value })
                }
                placeholder="Target score, rank goal, or conceptual milestones for this term..."
                className="w-full p-3 rounded-lg border border-[#E8E6E2] text-xs text-[#121827] focus:outline-none focus:border-[#C84428]"
              />
            </div>
          </div>

          {savedNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Profile saved. Practice questions and revision items have been calibrated.</span>
            </div>
          )}

          <div className="pt-3 border-t border-[#E8E6E2] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-lg border border-[#E8E6E2] text-xs font-semibold text-[#606B7C] hover:bg-[#F7F5F0] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="profile-save-btn"
              className="h-10 px-5 rounded-lg lm-btn-accent text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save Academic Profile</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
