const express = require('express')
const request = require('supertest')

let mockUser: any = { id: 1, role: 'supervisor' }
jest.mock('../middlewares/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
  requireRole: (...roles: any[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  },
  __setMockUser: (u: any) => { mockUser = u }
}))

const mockTask = { id: 12, teamId: 5, title: 'Task 1', description: 'Do work', deadline: new Date().toISOString(), status: 'pending', supervisorId: 2 }
const mockTeam = { id: 5, name: 'Team A', supervisorId: 2 }
const mockUpdatedTask = { ...mockTask, status: 'reviewed' }

const dbMock: any = {
  select: jest.fn(),
  update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([mockUpdatedTask])) })) })) }))
}

jest.mock('@workspace/db', () => ({
  db: dbMock,
  teamsTable: {},
  tasksTable: {},
  teamMembersTable: {},
  eq: (_a: any, _b: any) => ({}),
  and: jest.fn()
}))

import router from './tasks'

describe('PUT /tasks/:id', () => {
  let app: any

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(router)
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err?.message || String(err) })
    })
    dbMock.select.mockReset()
    dbMock.update.mockClear()
  })

  test('rejects students', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 3, role: 'student' })

    const res = await request(app).put('/tasks/12').send({ status: 'reviewed' })
    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error')
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  test('rejects supervisor who is not assigned to the task team', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 4, role: 'supervisor' })

    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTask])) })) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ id: 5, name: 'Other Team', supervisorId: 99 }])) })) }))

    const res = await request(app).put('/tasks/12').send({ status: 'reviewed' })
    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error')
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  test('allows assigned supervisor to update task', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 2, role: 'supervisor' })

    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTask])) })) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTeam])) })) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTeam])) })) }))

    const res = await request(app).put('/tasks/12').send({ status: 'reviewed' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 12, status: 'reviewed' })
  })

  test('allows coordinator to update any task', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 99, role: 'coordinator' })

    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTask])) })) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTeam])) })) }))

    const res = await request(app).put('/tasks/12').send({ status: 'reviewed' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 12, status: 'reviewed' })
  })
})
