import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  categories: string[];
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

export default function CategoryFilter({
  categories,
  activeFilter,
  onFilterChange,
}: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
      <FilterPill active={activeFilter === "all"} onClick={() => onFilterChange("all")}>
        All
      </FilterPill>
      <FilterPill active={activeFilter === "favorites"} onClick={() => onFilterChange("favorites")}>
        <Star
          className={cn(
            "h-3 w-3",
            activeFilter === "favorites" && "fill-yellow-500 text-yellow-500",
          )}
        />
        Favorites
      </FilterPill>
      {categories.map((cat) => (
        <FilterPill key={cat} active={activeFilter === cat} onClick={() => onFilterChange(cat)}>
          {cat}
        </FilterPill>
      ))}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
