import {
  CheckCircle,
  AlertCircle,
  Info,
  Search,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Minus,
  Star,
  Heart,
  Bookmark,
  Share,
  ExternalLink,
  RefreshCw,
  Loader,
  type LucideIcon,
} from "lucide-react";
import type { IconComponent } from "../types";
import { resolveString } from "../../hooks/useDataBinding";

interface A2UIIconProps {
  component: IconComponent["Icon"];
  dataModel: Record<string, unknown>;
}

const iconMap: Record<string, LucideIcon> = {
  "check-circle": CheckCircle,
  "alert-circle": AlertCircle,
  info: Info,
  search: Search,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  close: X,
  x: X,
  plus: Plus,
  minus: Minus,
  star: Star,
  heart: Heart,
  bookmark: Bookmark,
  share: Share,
  "external-link": ExternalLink,
  refresh: RefreshCw,
  loader: Loader,
};

export function A2UIIcon({ component, dataModel }: A2UIIconProps) {
  const iconName = resolveString(component.name, dataModel);
  const Icon = iconMap[iconName.toLowerCase()] || Info;

  return <Icon className="w-5 h-5 text-blue-600 flex-shrink-0" />;
}
