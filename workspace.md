# Graduation Project Hub

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Session**: express-session (cookie-based)
- **Auth**: bcryptjs password hashing

## Application: GPMS (Graduation Project Management System)

A full-stack web application for managing graduation projects at universities.

### Features

- **Authentication**: Register/login as Student, Supervisor, or Coordinator
- **Student Profiles**: GPA, skills, interests, description
- **Team Management**: Create teams, invite students, leader/member roles
- **Supervisor Requests**: Teams request supervision, supervisors accept/reject
- **Coordinator Tools**: Assign supervisors to teams, view workload
- **Project Phases**: Proposal → Progress → Final phase tracking
- **Tasks**: Supervisors assign tasks with deadlines per phase
- **Submissions**: Students submit deliverables, supervisors review
- **Meetings**: Students request meetings, supervisors approve/reject
- **Notifications**: Real-time notifications for all events
- **Activity Logs**: Audit trail of all system actions
- **Role Dashboards**: Tailored dashboards per role (student/supervisor/coordinator)

### Architecture

- `frontend/` — React + Vite frontend
- `backend/` — Express 5 API server
- `lib/db/` — Drizzle ORM schema & database client
- `lib/api-spec/` — OpenAPI spec (single source of truth)
- `lib/api-client-react/` — Generated React Query hooks
- `lib/api-zod/` — Generated Zod validation schemas

### Database Tables

- users, student_profiles, teams, team_members
- invitations, supervisor_requests, project_phases
- tasks, submissions, meetings, notifications, activity_logs

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.