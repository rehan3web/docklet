import React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";

interface AlertProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  className?: string;
}

const variantConfig: Record<
  AlertVariant,
  { iconBg: string; iconSrc: string; buttonTextColor: string }
> = {
  default: {
    iconBg: "bg-white/10",
    iconSrc: "/figmaAssets/icon-3.svg",
    buttonTextColor: "text-white",
  },
  info: {
    iconBg: "bg-blue-500/10",
    iconSrc: "/figmaAssets/icon-3.svg",
    buttonTextColor: "text-blue-400",
  },
  success: {
    iconBg: "bg-emerald-500/10",
    iconSrc: "/figmaAssets/icon.svg",
    buttonTextColor: "text-emerald-400",
  },
  warning: {
    iconBg: "bg-amber-500/10",
    iconSrc: "/figmaAssets/icon-1.svg",
    buttonTextColor: "text-amber-400",
  },
  error: {
    iconBg: "bg-red-500/10",
    iconSrc: "/figmaAssets/icon-1.svg",
    buttonTextColor: "text-red-400",
  },
};

export const Alert = ({
  variant = "default",
  title,
  description,
  actionLabel,
  onAction,
  onClose,
  className,
}: AlertProps) => {
  const config = variantConfig[variant];

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center gap-3 p-4 rounded-2xl overflow-hidden shadow-lg transition-all",
        "bg-white dark:bg-black border border-border/50",
        "w-full sm:min-w-[400px] max-w-full",
        className
      )}
    >
      <div className="flex items-center gap-3 w-full">
        {/* Icon container */}
        <div
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded-full shrink-0",
            config.iconBg
          )}
        >
          <img className="w-5 h-5" alt={variant} src={config.iconSrc} />
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {title && (
            <div className="text-sm font-semibold text-foreground truncate">
              {title}
            </div>
          )}
          <div className="text-sm text-foreground/80 font-medium">
            {description}
          </div>
        </div>

        {/* Action button */}
        {actionLabel && (
          <button
            onClick={onAction}
            className={cn(
              "px-3 py-1 font-bold text-xs tracking-tight transition-colors hover:opacity-80 shrink-0",
              config.buttonTextColor
            )}
          >
            {actionLabel.toUpperCase()}
          </button>
        )}

        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted/20 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
};

// Keep the demo Frame for reference or tests if needed, but renamed/modified
export const AlertDemo = (): JSX.Element => {
  return (
    <div className="flex flex-col gap-4 p-8 bg-muted/20">
      {(Object.keys(variantConfig) as AlertVariant[]).map((v) => (
        <Alert
          key={v}
          variant={v}
          description={`This is a ${v} toast message`}
          actionLabel="Button"
          onClose={() => { }}
        />
      ))}
    </div>
  );
};
