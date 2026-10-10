export interface NavItem {
  label: string;
  icon: string;
  /** absolute route; items without one render as "coming soon" */
  path?: string;
  /** shown only to users who have this permission */
  permission?: string;
  /** shown to users who have at least one of these */
  anyPermission?: string[];
}

export interface NavSection {
  title: string;
  collapsible: boolean;
  items: NavItem[];
}
