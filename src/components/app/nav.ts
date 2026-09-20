import {
  CalendarDays,
  Coins,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  to:
    | "/dashboard"
    | "/calendar"
    | "/courses"
    | "/import"
    | "/assignments"
    | "/finances"
    | "/assistant"
    | "/nemotron-test"
    | "/settings";
  icon: LucideIcon;
  /** Course-palette token used to tint the icon, so the rail reads at a glance. */
  tint: string;
};

export type NavGroup = { heading: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, tint: "text-course-leaf" },
      { label: "Calendar", to: "/calendar", icon: CalendarDays, tint: "text-course-blue" },
      { label: "Courses", to: "/courses", icon: GraduationCap, tint: "text-course-berry" },
      { label: "Import Semester", to: "/import", icon: Upload, tint: "text-course-teal" },
    ],
  },
  {
    heading: "Plan",
    items: [
      { label: "Assignments", to: "/assignments", icon: ListChecks, tint: "text-course-coral" },
      { label: "Finances", to: "/finances", icon: Coins, tint: "text-course-mustard" },
    ],
  },
  {
    heading: "Tools",
    items: [
      { label: "AI Assistant", to: "/assistant", icon: Sparkles, tint: "text-course-berry" },
      { label: "Settings", to: "/settings", icon: Settings, tint: "text-course-teal" },
    ],
  },
];

// Developer-only pages stay reachable by URL (/nemotron-test, /epub-test,
// /import-debug) but are deliberately kept out of the student-facing navigation.
