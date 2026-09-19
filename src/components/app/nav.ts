export type NavItem = {
  label: string;
  to:
    | "/dashboard"
    | "/calendar"
    | "/courses"
    | "/assignments"
    | "/finances"
    | "/assistant"
    | "/settings";
};

export type NavGroup = { heading: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Calendar", to: "/calendar" },
      { label: "Courses", to: "/courses" },
    ],
  },
  {
    heading: "Plan",
    items: [
      { label: "Assignments", to: "/assignments" },
      { label: "Finances", to: "/finances" },
    ],
  },
  {
    heading: "Tools",
    items: [
      { label: "AI Assistant", to: "/assistant" },
      { label: "Settings", to: "/settings" },
    ],
  },
];
