import Link from "next/link";
import { LearningDashboard } from "@/components/learning-dashboard";
import { ArrowRight, BookOpen, CircleHelp, GraduationCap } from "lucide-react";

export default function HomePage() {
  return <main id="main" className="home-workspace mx-auto pb-8">
    <LearningDashboard />
    <div className="home-secondary-links">
      <Link href="/directions?kb=open" className="editorial-text-link"><BookOpen size={17} />创建方向与上传资料<ArrowRight size={16} /></Link>
      <Link href="/guide" className="editorial-text-link"><GraduationCap size={17} />查看使用指南<ArrowRight size={16} /></Link>
      <Link href="/about" className="editorial-text-link"><CircleHelp size={17} />学习建议是怎样产生的？</Link>
    </div>
  </main>;
}
