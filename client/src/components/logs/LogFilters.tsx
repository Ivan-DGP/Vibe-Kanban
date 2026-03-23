import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LOG_CATEGORIES } from "@/lib/constants";

interface LogFiltersProps {
  level: string;
  category: string;
  onLevelChange: (level: string) => void;
  onCategoryChange: (category: string) => void;
  total: number;
  errorCount?: number;
  warnCount?: number;
}

export default function LogFilters({ level, category, onLevelChange, onCategoryChange, total, errorCount, warnCount }: LogFiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={level} onValueChange={onLevelChange}>
        <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="Level" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Levels</SelectItem>
          <SelectItem value="info">Info</SelectItem>
          <SelectItem value="warn">Warning</SelectItem>
          <SelectItem value="error">Error</SelectItem>
        </SelectContent>
      </Select>

      <Select value={category} onValueChange={onCategoryChange}>
        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {LOG_CATEGORIES.map((cat) => (
            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 ml-auto text-xs">
        <Badge variant="secondary">{total} total</Badge>
        {errorCount !== undefined && errorCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">{errorCount} errors</Badge>
        )}
        {warnCount !== undefined && warnCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-yellow-600">{warnCount} warnings</Badge>
        )}
      </div>
    </div>
  );
}
