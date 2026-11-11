"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { SUBJECTS } from "@/data/subjects";
import { useLearner } from "@/lib/useLearner";

export function CourseCatalog() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { learner, ready } = useLearner(SUBJECTS[0].id);
  const matching = SUBJECTS.filter((course) =>
    `${course.name} ${course.tagline} ${course.syllabus}`.includes(
      query.trim(),
    ),
  );
  const courses = expanded || query.trim() ? matching : matching.slice(0, 4);

  return (
    <section
      id="course-catalog"
      className="course-catalog"
      aria-label="内置课程目录"
    >
      <label className="course-search">
        <Search size={19} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索课程"
          aria-label="搜索课程"
        />
      </label>
      <div className="course-rows">
        {courses.map((course, index) => {
          const attempts =
            learner?.subjects[course.id]?.attempts.filter(
              (attempt) => !attempt.retired,
            ).length ?? 0;
          return (
            <article
              key={course.id}
              className={`course-row ${index === 0 ? "is-first" : ""}`}
            >
              <div className="course-row-title">
                <h2>{course.name}</h2>
                <p>{course.tagline}</p>
              </div>
              <p className="course-row-status">
                {course.graph.concepts.length} 个知识点
                <span>
                  {!ready
                    ? "正在读取记录…"
                    : attempts
                      ? `已作答 ${attempts} 题`
                      : "尚未测评"}
                </span>
              </p>
              <div className="course-row-actions">
                <Link
                  href={`/path?subject=${course.id}`}
                  className={index === 0 ? "course-open" : ""}
                >
                  {index === 0 ? "打开图谱" : "进入课程"}
                  <ArrowRight size={17} />
                </Link>
                {index === 0 ? (
                  <Link href={`/tutor?subject=${course.id}&materials=1`}>
                    <BookOpen size={17} />
                    阅读教材
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
        {!matching.length ? (
          <p className="course-search-empty">
            没有匹配的课程。可以换个关键词，或创建自己的学习方向。
          </p>
        ) : null}
      </div>
      {!query.trim() && matching.length > 4 ? (
        <button
          type="button"
          className="course-show-all"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起课程" : `查看全部 ${SUBJECTS.length} 门课程`}
          <ArrowRight size={17} />
        </button>
      ) : null}
    </section>
  );
}
