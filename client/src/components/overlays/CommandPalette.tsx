import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  ListTodo,
  BarChart3,
  ScrollText,
  Settings,
  HelpCircle,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useProjects } from "@/hooks";

const PAGES = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Tasks", path: "/tasks", icon: ListTodo },
  { name: "Reports", path: "/reports", icon: BarChart3 },
  { name: "Logs", path: "/logs", icon: ScrollText },
  { name: "Settings", path: "/settings", icon: Settings },
  { name: "Help", path: "/help", icon: HelpCircle },
];

export default function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useAppStore();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  const handleSelect = (path: string) => {
    navigate(path);
    setCommandPaletteOpen(false);
  };

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((page) => (
            <CommandItem key={page.path} value={page.name} onSelect={() => handleSelect(page.path)}>
              <page.icon className="mr-2 h-4 w-4" />
              {page.name}
            </CommandItem>
          ))}
        </CommandGroup>
        {projects && projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.name}
                onSelect={() => handleSelect(`/project/${project.id}`)}
              >
                <span className="mr-2 h-4 w-4 inline-flex items-center justify-center text-[10px] font-bold bg-muted rounded">
                  {project.name[0]?.toUpperCase()}
                </span>
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
