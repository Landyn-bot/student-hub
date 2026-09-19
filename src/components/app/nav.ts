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
};

export type NavGroup = { heading: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Calendar", to: "/calendar" },
      { label: "Courses", to: "/courses" },
      { label: "Import Semester", to: "/import" },
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
      // Developer-only sandbox for the Nemotron analysis service.
      { label: "Nemotron Test", to: "/nemotron-test" },
      { label: "Settings", to: "/settings" },
    ],
  },
];
