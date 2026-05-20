import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import profilesRouter from "./profiles";
import teamsRouter from "./teams";
import invitationsRouter from "./invitations";
import supervisorRequestsRouter from "./supervisor-requests";
import phasesRouter from "./phases";
import tasksRouter from "./tasks";
import submissionsRouter from "./submissions";
import meetingsRouter from "./meetings";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(profilesRouter);
router.use(teamsRouter);
router.use(invitationsRouter);
router.use(supervisorRequestsRouter);
router.use(phasesRouter);
router.use(tasksRouter);
router.use(submissionsRouter);
router.use(meetingsRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(storageRouter);

export default router;
