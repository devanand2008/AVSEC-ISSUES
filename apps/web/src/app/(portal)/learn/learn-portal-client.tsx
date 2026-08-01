"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Copy,
  Download,
  FileText,
  Layers3,
  Library,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SquareTerminal,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api } from "@/lib/api";
import styles from "./learn-portal.module.css";

type LearnView = "catalog" | "learning" | "results" | "compiler";

interface LearnHealth {
  ok: boolean;
  coursesAvailable: number;
  assessmentsAvailable: number;
}

interface LearnDashboard {
  totals: {
    courses: number;
    completedLessons: number;
    assessmentsTaken: number;
  };
}

interface LearnCount {
  modules?: number;
  resources?: number;
  assessments?: number;
  studentProgress?: number;
}

interface LearnCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: string | null;
  level: string | null;
  programmingLanguage: string | null;
  lessonCount: number;
  _count?: LearnCount;
}

interface LearnQuestion {
  id: string;
  type: "mcq" | "code";
  question: string;
  options?: string[];
  starterCode?: string | null;
  marks: number;
}

interface LearnAssessment {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  type: "QUIZ" | "EXAM" | "ASSIGNMENT" | "CODING";
  maxScore: number;
  passingScore: number;
  questionsJson: {
    scope?: "lesson" | "final";
    lessonId?: string;
    durationMinutes?: number;
    questions?: LearnQuestion[];
  };
}

interface LearnLesson {
  id: string;
  title: string;
  content: string | null;
  videoUrl: string | null;
  level: string | null;
  lessonType: string | null;
  durationMinutes: number | null;
  exampleCode: string | null;
  programmingLanguage: string | null;
  sortOrder: number;
}

interface LearnResource {
  id: string;
  title: string;
  description: string | null;
  type: string;
  url: string;
}

interface LearnModule {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  lessons: LearnLesson[];
  resources: LearnResource[];
}

interface LearnCourseDetail extends LearnCourse {
  modules: LearnModule[];
  resources: LearnResource[];
  assessments: LearnAssessment[];
  studentProgress: Array<{ lessonId: string; completedAt: string }>;
}

interface LearnProgress {
  completedLessons: number;
  totalLessons: number;
  percent: number | null;
  items: Array<{ lessonId: string; completedAt: string }>;
}

interface LearnBookmark {
  id: string;
  lessonId: string;
  createdAt: string;
  lesson: {
    id: string;
    title: string;
    module: {
      id: string;
      title: string;
      course: { id: string; code: string; title: string };
    };
  };
}

interface LearnResult {
  id: string;
  score: number;
  passed: boolean;
  completedAt: string;
  course: { id: string; code: string; title: string };
  assessment: {
    id: string;
    title: string;
    type: LearnAssessment["type"];
    maxScore: number;
    passingScore: number;
  };
}

interface LearnCertificate {
  id: string;
  certificateNumber: string;
  score: number;
  issuedAt: string;
  course: { id: string; code: string; title: string };
}

interface CertificateResponse {
  items: LearnCertificate[];
  eligibleCourses: Array<{ courseId: string; code: string; title: string }>;
  message: string;
}

interface AssessmentStartResponse {
  assessment: LearnAssessment;
  attempt: { startedAt: string; mode: string };
}

interface AssessmentSubmitResponse extends LearnResult {
  certificate?: LearnCertificate | null;
}

interface CompilerResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  provider: string;
}

const STARTERS: Record<string, string> = {
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, AVS Learn!\\n");\n    return 0;\n}',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, AVS Learn!" << endl;\n    return 0;\n}',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, AVS Learn!");\n    }\n}',
  python: 'print("Hello, AVS Learn!")',
  javascript: 'console.log("Hello, AVS Learn!");',
  sql: "CREATE TABLE students (id INTEGER, name TEXT);\nINSERT INTO students VALUES (1, 'AVS Student');\nSELECT * FROM students;",
};

const LANGUAGES = [
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "sql", label: "SQL" },
];

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "blue" | "green" | "amber" | "violet";
}) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statIcon} ${styles[tone]}`}>
        <Icon size={19} />
      </span>
      <span>
        <strong>{value.toLocaleString()}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className={styles.progressTrack} aria-label={`${value}% complete`}>
      <span className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function ResourceList({ resources }: { resources: LearnResource[] }) {
  if (!resources.length) return null;
  return (
    <div className={styles.resourceList}>
      {resources.map((resource) => (
        <a href={resource.url} key={resource.id} rel="noreferrer" target="_blank">
          <FileText size={17} />
          <span>
            <strong>{resource.title}</strong>
            <small>{resource.type}</small>
          </span>
          <Download size={15} />
        </a>
      ))}
    </div>
  );
}

export function LearnPortalClient() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<LearnView>("catalog");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [assessmentSession, setAssessmentSession] = useState<LearnAssessment | null>(null);
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, string | number>>({});
  const [assessmentOutcome, setAssessmentOutcome] = useState<AssessmentSubmitResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [compilerLanguage, setCompilerLanguage] = useState("c");
  const [compilerCode, setCompilerCode] = useState(STARTERS.c ?? "");
  const [compilerInput, setCompilerInput] = useState("");
  const [compilerOutput, setCompilerOutput] = useState("");

  const health = useQuery({
    queryKey: ["learn", "health"],
    queryFn: () => api.get<LearnHealth>("/learn/health"),
  });
  const dashboard = useQuery({
    queryKey: ["learn", "dashboard"],
    queryFn: () => api.get<LearnDashboard>("/learn/dashboard"),
  });
  const courses = useQuery({
    queryKey: ["learn", "courses"],
    queryFn: () => api.get<LearnCourse[]>("/learn/courses"),
  });
  const bookmarks = useQuery({
    queryKey: ["learn", "bookmarks"],
    queryFn: () => api.get<LearnBookmark[]>("/learn/bookmarks"),
  });
  const results = useQuery({
    queryKey: ["learn", "results"],
    queryFn: () => api.get<LearnResult[]>("/learn/results"),
  });
  const certificates = useQuery({
    queryKey: ["learn", "certificates"],
    queryFn: () => api.get<CertificateResponse>("/learn/certificates"),
  });

  const selectedCourse = selectedCourseId ?? courses.data?.[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["learn", "course", selectedCourse],
    queryFn: () => api.get<LearnCourseDetail>(`/learn/courses/${selectedCourse}`),
    enabled: Boolean(selectedCourse),
  });
  const progress = useQuery({
    queryKey: ["learn", "progress", selectedCourse],
    queryFn: () => api.get<LearnProgress>(`/learn/progress?courseId=${selectedCourse}`),
    enabled: Boolean(selectedCourse),
  });

  const lessons = useMemo(
    () => detail.data?.modules.flatMap((module) => module.lessons) ?? [],
    [detail.data?.modules],
  );
  const completedLessonIds = useMemo(() => {
    const ids = new Set<string>();
    detail.data?.studentProgress.forEach((item) => ids.add(item.lessonId));
    progress.data?.items.forEach((item) => ids.add(item.lessonId));
    return ids;
  }, [detail.data?.studentProgress, progress.data?.items]);
  const bookmarkedLessonIds = useMemo(
    () => new Set(bookmarks.data?.map((bookmark) => bookmark.lessonId) ?? []),
    [bookmarks.data],
  );
  const progressPercent = lessons.length ? Math.round((completedLessonIds.size / lessons.length) * 100) : 0;
  const activeLesson = lessons.find((lesson) => lesson.id === activeLessonId) ?? lessons[0] ?? null;
  const activeLessonIndex = activeLesson ? lessons.findIndex((lesson) => lesson.id === activeLesson.id) : -1;
  const lessonAssessments =
    detail.data?.assessments.filter(
      (assessment) =>
        assessment.questionsJson?.scope === "lesson" &&
        assessment.questionsJson.lessonId === activeLesson?.id,
    ) ?? [];
  const finalExam = detail.data?.assessments.find(
    (assessment) => assessment.type === "EXAM" || assessment.questionsJson?.scope === "final",
  );
  const latestResultByAssessment = useMemo(() => {
    const map = new Map<string, LearnResult>();
    results.data?.forEach((result) => {
      if (!map.has(result.assessment.id)) map.set(result.assessment.id, result);
    });
    return map;
  }, [results.data]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(courses.data?.map((course) => course.category || "Other") ?? [])).sort()],
    [courses.data],
  );
  const filteredCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (courses.data ?? []).filter((course) => {
      const categoryMatches = category === "All" || (course.category || "Other") === category;
      const textMatches =
        !query ||
        `${course.title} ${course.code} ${course.category ?? ""} ${course.description ?? ""}`
          .toLowerCase()
          .includes(query);
      return categoryMatches && textMatches;
    });
  }, [category, courses.data, search]);

  const markComplete = useMutation({
    mutationFn: (data: { courseId: string; lessonId: string; completed: boolean }) =>
      api.post("/learn/progress", data),
    onSuccess: async () => {
      setNotice("Lesson progress saved.");
      await queryClient.invalidateQueries({ queryKey: ["learn"] });
    },
  });
  const toggleBookmark = useMutation({
    mutationFn: (lessonId: string) => api.post<{ bookmarked: boolean }>(`/learn/bookmarks/${lessonId}/toggle`),
    onSuccess: async (data) => {
      setNotice(data.bookmarked ? "Lesson bookmarked." : "Bookmark removed.");
      await queryClient.invalidateQueries({ queryKey: ["learn", "bookmarks"] });
    },
  });
  const startAssessment = useMutation({
    mutationFn: (assessmentId: string) =>
      api.post<AssessmentStartResponse>(`/learn/assessments/${assessmentId}/start`),
    onSuccess: ({ assessment }) => {
      const answers: Record<string, string | number> = {};
      assessment.questionsJson.questions?.forEach((question) => {
        if (question.type === "code") answers[question.id] = question.starterCode ?? "";
      });
      setAssessmentAnswers(answers);
      setAssessmentOutcome(null);
      setAssessmentSession(assessment);
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const submitAssessment = useMutation({
    mutationFn: () => {
      if (!assessmentSession) throw new Error("Assessment is not open.");
      return api.post<AssessmentSubmitResponse>(
        `/learn/assessments/${assessmentSession.id}/submit`,
        { answersJson: assessmentAnswers },
      );
    },
    onSuccess: async (outcome) => {
      setAssessmentOutcome(outcome);
      setNotice(outcome.passed ? "Assessment passed and saved." : "Result saved. Review the lesson and try again.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learn", "results"] }),
        queryClient.invalidateQueries({ queryKey: ["learn", "certificates"] }),
        queryClient.invalidateQueries({ queryKey: ["learn", "dashboard"] }),
      ]);
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const runCompiler = useMutation({
    mutationFn: () =>
      api.post<CompilerResponse>("/learn/compiler/run", {
        language: compilerLanguage,
        sourceCode: compilerCode,
        stdin: compilerInput,
      }),
    onSuccess: (result) => {
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setCompilerOutput(output || `Program finished with exit code ${result.exitCode ?? 0}.`);
    },
    onError: (error: Error) => setCompilerOutput(error.message),
  });

  const openCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setActiveLessonId(null);
    setView("learning");
  };
  const openCompiler = (language?: string | null, code?: string | null) => {
    const supported = LANGUAGES.some((item) => item.id === language) ? language! : compilerLanguage;
    setCompilerLanguage(supported);
    setCompilerCode(code || STARTERS[supported] || "");
    setCompilerOutput("");
    setView("compiler");
  };
  const changeCompilerLanguage = (language: string) => {
    setCompilerLanguage(language);
    setCompilerCode(STARTERS[language] || "");
    setCompilerOutput("");
  };

  const loading = health.isLoading || dashboard.isLoading || courses.isLoading;
  const failed = health.isError || dashboard.isError || courses.isError;

  return (
    <div className={styles.portal}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">AVS Engineering College</span>
          <h1>AVS Skill Portal</h1>
          <p>Programming courses, practical labs, exams and certification.</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["learn"] })}
          type="button"
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </header>

      <nav className={styles.viewTabs} aria-label="Learn portal sections">
        {[
          { id: "catalog" as const, label: "Course catalog", icon: Library },
          { id: "learning" as const, label: "My learning", icon: BookOpen },
          { id: "compiler" as const, label: "Compiler", icon: SquareTerminal },
          { id: "results" as const, label: "Results", icon: Award },
        ].map((item) => (
          <button
            aria-current={view === item.id ? "page" : undefined}
            className={view === item.id ? styles.activeTab : ""}
            key={item.id}
            onClick={() => setView(item.id)}
            type="button"
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </nav>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice("")} type="button">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState rows={6} />
      ) : failed ? (
        <ErrorState message="AVS Learn could not load. Check your login and API connection." />
      ) : (
        <>
          <section className={styles.statsBand}>
            <Stat
              icon={Library}
              label="Courses"
              tone="blue"
              value={dashboard.data?.totals.courses ?? health.data?.coursesAvailable ?? 0}
            />
            <Stat
              icon={CheckCircle2}
              label="Lessons complete"
              tone="green"
              value={dashboard.data?.totals.completedLessons ?? 0}
            />
            <Stat
              icon={ListChecks}
              label="Assessments taken"
              tone="amber"
              value={dashboard.data?.totals.assessmentsTaken ?? 0}
            />
            <Stat
              icon={Award}
              label="Certificates"
              tone="violet"
              value={certificates.data?.items.length ?? 0}
            />
          </section>

          {view === "catalog" && (
            <section className={styles.catalog}>
              <div className={styles.catalogTools}>
                <label className={styles.searchBox}>
                  <Search size={18} />
                  <input
                    aria-label="Search courses"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search programming, web, database, AI..."
                    type="search"
                    value={search}
                  />
                </label>
                <select
                  aria-label="Course category"
                  className="input"
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {!filteredCourses.length ? (
                <EmptyState title="No matching courses" message="Try another title or category." />
              ) : (
                <div className={styles.courseGrid}>
                  {filteredCourses.map((course, index) => {
                    const complete = Math.min(
                      100,
                      course.lessonCount
                        ? Math.round(((course._count?.studentProgress ?? 0) / course.lessonCount) * 100)
                        : 0,
                    );
                    return (
                      <article className={styles.courseCard} key={course.id}>
                        <div className={styles.courseCardTop}>
                          <span className={styles.courseIndex}>{String(index + 1).padStart(2, "0")}</span>
                          <span className="badge badge-blue">{course.category || "Learning"}</span>
                        </div>
                        <div>
                          <small>{course.code}</small>
                          <h2>{course.title}</h2>
                          <p>{course.description}</p>
                        </div>
                        <div className={styles.courseFacts}>
                          <span>
                            <BookOpen size={15} /> {course.lessonCount} lessons
                          </span>
                          <span>
                            <Layers3 size={15} /> {course.level || "All levels"}
                          </span>
                        </div>
                        <div className={styles.courseProgress}>
                          <span>
                            <small>Progress</small>
                            <strong>{complete}%</strong>
                          </span>
                          <ProgressBar value={complete} />
                        </div>
                        <button className="btn btn-primary" onClick={() => openCourse(course.id)} type="button">
                          <Play size={17} />
                          {complete ? "Continue course" : "Start course"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {view === "learning" && (
            <section>
              {!courses.data?.length ? (
                <EmptyState title="No courses available" message="Published AVS Learn courses will appear here." />
              ) : (
                <>
                  <div className={styles.coursePicker}>
                    <label>
                      <span>Active course</span>
                      <select
                        className="input"
                        onChange={(event) => {
                          setSelectedCourseId(event.target.value);
                          setActiveLessonId(null);
                        }}
                        value={selectedCourse ?? ""}
                      >
                        {courses.data.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn btn-secondary" onClick={() => setView("catalog")} type="button">
                      <ArrowLeft size={17} />
                      Catalog
                    </button>
                  </div>

                  {detail.isLoading ? (
                    <LoadingState rows={6} />
                  ) : detail.isError || !detail.data ? (
                    <ErrorState message="This course could not be loaded." />
                  ) : (
                    <div className={styles.workspace}>
                      <aside className={styles.lessonRail}>
                        <div className={styles.courseSummary}>
                          <span className="eyebrow">{detail.data.code}</span>
                          <h2>{detail.data.title}</h2>
                          <div>
                            <span>{completedLessonIds.size}/{lessons.length} lessons</span>
                            <strong>{progressPercent}%</strong>
                          </div>
                          <ProgressBar value={progressPercent} />
                        </div>
                        <div className={styles.moduleList}>
                          {detail.data.modules.map((module) => (
                            <section key={module.id}>
                              <h3>{module.title}</h3>
                              {module.lessons.map((lesson) => {
                                const active = lesson.id === activeLesson?.id;
                                const complete = completedLessonIds.has(lesson.id);
                                return (
                                  <button
                                    className={active ? styles.activeLesson : ""}
                                    key={lesson.id}
                                    onClick={() => setActiveLessonId(lesson.id)}
                                    type="button"
                                  >
                                    {complete ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                                    <span>{lesson.title}</span>
                                    {bookmarkedLessonIds.has(lesson.id) && <Bookmark size={14} />}
                                  </button>
                                );
                              })}
                            </section>
                          ))}
                        </div>
                        {finalExam && (
                          <button
                            className={styles.examButton}
                            disabled={progressPercent < 100 || startAssessment.isPending}
                            onClick={() => startAssessment.mutate(finalExam.id)}
                            type="button"
                          >
                            {progressPercent < 100 ? <LockKeyhole size={18} /> : <Trophy size={18} />}
                            <span>
                              <strong>Final exam</strong>
                              <small>
                                {progressPercent < 100 ? `${completedLessonIds.size}/${lessons.length} complete` : "100 marks / pass 60"}
                              </small>
                            </span>
                          </button>
                        )}
                      </aside>

                      <main className={styles.lessonReader}>
                        {!activeLesson ? (
                          <EmptyState title="No lessons published" message="Course content will appear here." />
                        ) : (
                          <>
                            <header className={styles.lessonHeader}>
                              <div className={styles.lessonMeta}>
                                <span className="badge badge-blue">{activeLesson.level || "Course lesson"}</span>
                                <span>
                                  <Clock3 size={14} /> {activeLesson.durationMinutes || 20} min
                                </span>
                                <span>
                                  Lesson {activeLessonIndex + 1} of {lessons.length}
                                </span>
                              </div>
                              <button
                                aria-label={bookmarkedLessonIds.has(activeLesson.id) ? "Remove bookmark" : "Bookmark lesson"}
                                className={styles.iconButton}
                                disabled={toggleBookmark.isPending}
                                onClick={() => toggleBookmark.mutate(activeLesson.id)}
                                title={bookmarkedLessonIds.has(activeLesson.id) ? "Remove bookmark" : "Bookmark lesson"}
                                type="button"
                              >
                                {bookmarkedLessonIds.has(activeLesson.id) ? (
                                  <BookmarkCheck size={20} />
                                ) : (
                                  <Bookmark size={20} />
                                )}
                              </button>
                            </header>
                            <h1>{activeLesson.title}</h1>
                            {activeLesson.videoUrl && (
                              <div className={styles.videoWrapper} style={{ marginBottom: 20, borderRadius: 12, overflow: "hidden", background: "#000" }}>
                                <video controls src={activeLesson.videoUrl} style={{ width: "100%", display: "block", maxHeight: 500 }} />
                              </div>
                            )}
                            <div className={styles.lessonContent}>
                              {(activeLesson.content || "Lesson content is being prepared.")
                                .split(/\n{2,}/)
                                .filter(Boolean)
                                .map((paragraph, index) => (
                                  <p key={`${activeLesson.id}-${index}`}>{paragraph}</p>
                                ))}
                            </div>

                            {activeLesson.exampleCode && (
                              <section className={styles.codeSample}>
                                <header>
                                  <span>
                                    <Code2 size={17} />
                                    {activeLesson.programmingLanguage || "Example"}
                                  </span>
                                  <div>
                                    <button
                                      aria-label="Copy example code"
                                      onClick={() => {
                                        navigator.clipboard.writeText(activeLesson.exampleCode || "");
                                        setNotice("Example copied.");
                                      }}
                                      title="Copy code"
                                      type="button"
                                    >
                                      <Copy size={16} />
                                    </button>
                                    <button
                                      onClick={() =>
                                        openCompiler(activeLesson.programmingLanguage, activeLesson.exampleCode)
                                      }
                                      type="button"
                                    >
                                      <Play size={16} />
                                      Run
                                    </button>
                                  </div>
                                </header>
                                <pre>{activeLesson.exampleCode}</pre>
                              </section>
                            )}

                            <ResourceList resources={detail.data.resources} />

                            {!!lessonAssessments.length && (
                              <section className={styles.assessmentStrip}>
                                <h2>Lesson assessments</h2>
                                <div>
                                  {lessonAssessments.map((assessment) => {
                                    const previous = latestResultByAssessment.get(assessment.id);
                                    return (
                                      <button
                                        disabled={startAssessment.isPending}
                                        key={assessment.id}
                                        onClick={() => startAssessment.mutate(assessment.id)}
                                        type="button"
                                      >
                                        {assessment.type === "QUIZ" ? <ListChecks size={19} /> : <Code2 size={19} />}
                                        <span>
                                          <strong>{assessment.title}</strong>
                                          <small>
                                            {assessment.maxScore} marks / pass {assessment.passingScore}
                                          </small>
                                        </span>
                                        {previous && (
                                          <span className={previous.passed ? "badge badge-green" : "badge badge-orange"}>
                                            {previous.score}/{previous.assessment.maxScore}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </section>
                            )}

                            <footer className={styles.lessonFooter}>
                              <button
                                className="btn btn-secondary"
                                disabled={activeLessonIndex <= 0}
                                onClick={() => setActiveLessonId(lessons[activeLessonIndex - 1]?.id ?? null)}
                                type="button"
                              >
                                <ChevronLeft size={17} />
                                Previous
                              </button>
                              <button
                                className={
                                  completedLessonIds.has(activeLesson.id)
                                    ? "btn btn-secondary"
                                    : "btn btn-primary"
                                }
                                disabled={markComplete.isPending}
                                onClick={() =>
                                  markComplete.mutate({
                                    courseId: detail.data.id,
                                    lessonId: activeLesson.id,
                                    completed: !completedLessonIds.has(activeLesson.id),
                                  })
                                }
                                type="button"
                              >
                                <Check size={17} />
                                {completedLessonIds.has(activeLesson.id) ? "Completed" : "Mark complete"}
                              </button>
                              <button
                                className="btn btn-secondary"
                                disabled={activeLessonIndex >= lessons.length - 1}
                                onClick={() => setActiveLessonId(lessons[activeLessonIndex + 1]?.id ?? null)}
                                type="button"
                              >
                                Next
                                <ChevronRight size={17} />
                              </button>
                            </footer>
                          </>
                        )}
                      </main>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {view === "compiler" && (
            <section className={styles.compiler}>
              <header>
                <div>
                  <span className="eyebrow">Programming lab</span>
                  <h2>Online compiler</h2>
                </div>
                <div className={styles.languageTabs}>
                  {LANGUAGES.map((language) => (
                    <button
                      className={compilerLanguage === language.id ? styles.activeLanguage : ""}
                      key={language.id}
                      onClick={() => changeCompilerLanguage(language.id)}
                      type="button"
                    >
                      {language.label}
                    </button>
                  ))}
                </div>
              </header>
              <div className={styles.compilerGrid}>
                <section className={styles.editorPane}>
                  <header>
                    <span>
                      <Code2 size={16} /> main
                    </span>
                    <div>
                      <button
                        aria-label="Reset code"
                        onClick={() => setCompilerCode(STARTERS[compilerLanguage] || "")}
                        title="Reset code"
                        type="button"
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button
                        aria-label="Copy code"
                        onClick={() => navigator.clipboard.writeText(compilerCode)}
                        title="Copy code"
                        type="button"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </header>
                  <textarea
                    aria-label="Source code"
                    onChange={(event) => setCompilerCode(event.target.value)}
                    spellCheck={false}
                    value={compilerCode}
                  />
                </section>
                <section className={styles.outputPane}>
                  <label>
                    <span>Standard input</span>
                    <textarea
                      onChange={(event) => setCompilerInput(event.target.value)}
                      placeholder="Optional input"
                      value={compilerInput}
                    />
                  </label>
                  <div className={styles.output}>
                    <header>
                      <span>
                        <SquareTerminal size={16} /> Output
                      </span>
                      <button
                        className="btn btn-primary"
                        disabled={runCompiler.isPending || !compilerCode.trim()}
                        onClick={() => runCompiler.mutate()}
                        type="button"
                      >
                        {runCompiler.isPending ? <LoaderCircle className={styles.spin} size={17} /> : <Play size={17} />}
                        Run code
                      </button>
                    </header>
                    <pre>{compilerOutput || "Output will appear here."}</pre>
                  </div>
                </section>
              </div>
            </section>
          )}

          {view === "results" && (
            <section className={styles.resultsLayout}>
              <div>
                <header className={styles.sectionHeading}>
                  <div>
                    <span className="eyebrow">Performance</span>
                    <h2>Assessment results</h2>
                  </div>
                </header>
                {!results.data?.length ? (
                  <EmptyState title="No results yet" message="Completed quizzes and exams will appear here." />
                ) : (
                  <div className={styles.resultList}>
                    {results.data.map((result) => (
                      <article key={result.id}>
                        <span className={result.passed ? styles.passMark : styles.retryMark}>
                          {result.passed ? <CheckCircle2 size={20} /> : <RotateCcw size={20} />}
                        </span>
                        <div>
                          <strong>{result.assessment.title}</strong>
                          <small>
                            {result.course.title} / {new Date(result.completedAt).toLocaleDateString("en-IN")}
                          </small>
                        </div>
                        <span>
                          <strong>
                            {result.score}/{result.assessment.maxScore}
                          </strong>
                          <small>{result.passed ? "Passed" : "Try again"}</small>
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <header className={styles.sectionHeading}>
                  <div>
                    <span className="eyebrow">Credentials</span>
                    <h2>Certificates</h2>
                  </div>
                </header>
                {!certificates.data?.items.length ? (
                  <EmptyState
                    title="No certificates issued"
                    message={certificates.data?.message || "Pass a final exam to earn a certificate."}
                  />
                ) : (
                  <div className={styles.certificateList}>
                    {certificates.data.items.map((certificate) => (
                      <article key={certificate.id}>
                        <Award size={32} />
                        <div>
                          <small>{certificate.certificateNumber}</small>
                          <strong>{certificate.course.title}</strong>
                          <span>
                            Score {certificate.score}/100 / {new Date(certificate.issuedAt).toLocaleDateString("en-IN")}
                          </span>
                        </div>
                        <button
                          aria-label={`Download ${certificate.course.title} certificate`}
                          onClick={() =>
                            api.download(
                              `/learn/certificates/${certificate.id}/download`,
                              `${certificate.course.code}-certificate.pdf`,
                            )
                          }
                          title="Download certificate"
                          type="button"
                        >
                          <Download size={19} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {assessmentSession && (
        <div className={styles.modalBackdrop} role="presentation">
          <section aria-labelledby="assessment-title" aria-modal="true" className={styles.assessmentModal} role="dialog">
            <header>
              <div>
                <span className="eyebrow">{assessmentSession.type}</span>
                <h2 id="assessment-title">{assessmentSession.title}</h2>
                <p>
                  {assessmentSession.maxScore} marks / pass {assessmentSession.passingScore}
                </p>
              </div>
              <button
                aria-label="Close assessment"
                onClick={() => setAssessmentSession(null)}
                title="Close"
                type="button"
              >
                <X size={20} />
              </button>
            </header>

            {assessmentOutcome ? (
              <div className={styles.outcome}>
                <span className={assessmentOutcome.passed ? styles.passMark : styles.retryMark}>
                  {assessmentOutcome.passed ? <Trophy size={34} /> : <RotateCcw size={34} />}
                </span>
                <h3>{assessmentOutcome.passed ? "Assessment passed" : "Review and try again"}</h3>
                <strong>
                  {assessmentOutcome.score}/{assessmentSession.maxScore}
                </strong>
                {assessmentOutcome.certificate && <p>Your AVS Learn certificate has been issued.</p>}
                <div>
                  <button className="btn btn-secondary" onClick={() => setAssessmentSession(null)} type="button">
                    Close
                  </button>
                  {assessmentOutcome.certificate && (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setAssessmentSession(null);
                        setView("results");
                      }}
                      type="button"
                    >
                      <Award size={17} />
                      View certificate
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className={styles.questions}>
                  {(assessmentSession.questionsJson.questions ?? []).map((question, index) => (
                    <fieldset key={question.id}>
                      <legend>
                        <span>{index + 1}</span>
                        {question.question}
                        <small>{question.marks} marks</small>
                      </legend>
                      {question.type === "mcq" ? (
                        <div className={styles.options}>
                          {question.options?.map((option, optionIndex) => (
                            <label key={`${question.id}-${optionIndex}`}>
                              <input
                                checked={Number(assessmentAnswers[question.id]) === optionIndex}
                                name={question.id}
                                onChange={() =>
                                  setAssessmentAnswers((current) => ({
                                    ...current,
                                    [question.id]: optionIndex,
                                  }))
                                }
                                type="radio"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.codeAnswer}>
                          <textarea
                            aria-label={`Answer for question ${index + 1}`}
                            onChange={(event) =>
                              setAssessmentAnswers((current) => ({
                                ...current,
                                [question.id]: event.target.value,
                              }))
                            }
                            spellCheck={false}
                            value={String(assessmentAnswers[question.id] ?? question.starterCode ?? "")}
                          />
                          {assessmentSession.type === "CODING" && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => {
                                setAssessmentSession(null);
                                openCompiler(
                                  detail.data?.programmingLanguage,
                                  String(assessmentAnswers[question.id] ?? question.starterCode ?? ""),
                                );
                              }}
                              type="button"
                            >
                              <SquareTerminal size={17} />
                              Open in compiler
                            </button>
                          )}
                        </div>
                      )}
                    </fieldset>
                  ))}
                </div>
                <footer>
                  <button className="btn btn-secondary" onClick={() => setAssessmentSession(null)} type="button">
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={submitAssessment.isPending}
                    onClick={() => submitAssessment.mutate()}
                    type="button"
                  >
                    {submitAssessment.isPending ? (
                      <LoaderCircle className={styles.spin} size={17} />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}
                    Submit assessment
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
