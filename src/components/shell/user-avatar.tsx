import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  initials: string;
  color?: string | null;
  className?: string;
  title?: string;
}

/**
 * Initials avatar. Seeded users carry their own `avatarColor`, which keeps the
 * activity feed and approval chain visually scannable without any image assets.
 */
export function UserAvatar({
  initials,
  color,
  className,
  title,
}: UserAvatarProps) {
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
        className,
      )}
      style={{ backgroundColor: color ?? "#525252" }}
    >
      {initials}
    </span>
  );
}
