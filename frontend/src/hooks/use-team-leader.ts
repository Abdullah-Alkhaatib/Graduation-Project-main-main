import { useAuth } from "@/lib/auth";
import { useGetMyTeam, getGetMyTeamQueryKey } from "@workspace/api-client-react";

/**
 * Hook to check if the current student user is a team leader
 * @returns boolean indicating if the user is a team leader, or null if still loading
 */
export function useIsTeamLeader(): boolean | null {
  const { user } = useAuth();
  
  const { data: myTeam, isLoading } = useGetMyTeam({
    query: {
      queryKey: getGetMyTeamQueryKey(),
      enabled: user?.role === 'student',
      retry: false
    }
  });

  // If not a student, return false
  if (user?.role !== 'student') {
    return false;
  }

  // If still loading, return null
  if (isLoading) {
    return null;
  }

  // Check if user is the team leader
  if (!myTeam || !user?.id) {
    return false;
  }

  return myTeam.leaderId === user.id;
}
