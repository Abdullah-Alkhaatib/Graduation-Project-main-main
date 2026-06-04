Use Cases for GPMS - Key Features

1. Authentication (student / supervisor)
   - Use case: Register
     - Actor: student or supervisor
     - Precondition: valid email and password; students must include gender
     - Flow: User submits registration -> system validates -> creates user and student profile (if student) -> log activity
     - Postcondition: User account created; student profile created for students
   - Use case: Login
     - Actor: any registered user
     - Flow: Submit credentials -> verify -> create session

2. Team Invitations
   - Use case: Team leader invites student
     - Actor: Team leader
     - Preconditions: leader is authenticated and team exists; invited student exists and is not already in a team
     - Flow: Leader sends invite -> if no other reviewers mark teamApproved and notify candidate; otherwise create reviewer votes and notify reviewers
     - Postcondition: Invitation record created; notifications sent
   - Use case: Student accepts invitation
     - Actor: invited student
     - Preconditions: invitation visible to student, not already responded
     - Flow: Student accepts -> if teamApproved and capacity ok, add to team -> notify leader

3. Meetings
   - Use case: Team leader requests meeting with assigned supervisor
     - Actor: Team leader
     - Preconditions: leader is authenticated and team has assigned supervisor; supervisor has defined office hours
     - Flow: Leader selects a supervisor slot -> system verifies slot -> creates meeting request -> notify supervisor

4. Discussion Scheduling
   - Use case: Generate discussion schedule
     - Actor: Coordinator (system process)
     - Preconditions: teams with assigned supervisors; sufficient rooms/examiners/time slots
     - Flow: Scheduler computes slots and assigns examiners avoiding conflicts and respecting penalties -> returns schedule and warnings

5. Invitations voting and finalization
   - Use case: Team members vote on invitation
     - Actor: Team member (reviewer)
     - Flow: Member votes -> when all votes are accepted, scheduler marks teamApproved and notifies candidate

Notes: These use cases map to backend route behaviors implemented in `backend/src/routes/*` and services in `backend/src/services/*`.
