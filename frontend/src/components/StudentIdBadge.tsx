import React from "react";
import { useGetProfile } from "@workspace/api-client-react";

type Props = { userId: number; className?: string };

export default function StudentIdBadge({ userId, className }: Props) {
  const { data: profile, isLoading } = useGetProfile(userId, {
    query: { enabled: !!userId },
  });

  if (isLoading) return null;
  if (!profile?.studentId) return null;

  return (
    <span className={className}>
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
        ID: {profile.studentId}
      </span>
    </span>
  );
}
