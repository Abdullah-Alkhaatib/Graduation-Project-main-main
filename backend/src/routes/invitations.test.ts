const express = require('express')
const request = require('supertest')

let mockUser: any = { id: 1, role: 'leader' }
jest.mock('../middlewares/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
  __setMockUser: (u: any) => { mockUser = u }
}))

const mockInvitation = { id: 10, teamId: 1, invitedUserId: 3, invitedByUserId: 1, requiresTeamApproval: true, teamApproved: true, createdAt: new Date().toISOString() }
const mockTeam = { id: 1, name: 'Team A', leaderId: 1, supervisorId: 2 }
const mockStudentProfile = { userId: 3, studentId: 'ABC123' }
const mockCandidateUser = { id: 3, name: 'Student', email: 's@example.com', role: 'student', createdAt: new Date().toISOString() }

const dbMock: any = {
  select: jest.fn(),
  insert: jest.fn(() => ({ values: () => ({ returning: () => Promise.resolve([mockInvitation]) }) })),
  update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(() => ({ returning: () => Promise.resolve([]) }) ) })) })),
}

jest.mock('@workspace/db', () => ({ db: dbMock, usersTable: {}, teamsTable: {}, invitationsTable: {}, teamMembersTable: {}, studentProfilesTable: {}, eq: (_a: any, _b: any) => ({}), and: (..._args: any[]) => ({}), sql: jest.fn((..._args: any[]) => 'SQL') }))

import router from './invitations'

describe('POST /invitations', () => {
  let app: any
  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(router)
    // error handler to surface server errors during tests
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: any, res: any, _next: any) => {
      console.error('SERVER ERROR:', err && err.stack ? err.stack : err)
      res.status(500).json({ error: err?.message || String(err) })
    })
  })

  test('missing body fields -> 400', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'leader' })
    const res = await request(app).post('/invitations').send({})
    expect(res.status).toBe(400)
  })

  test('successful invite when team leader and no reviewers', async () => {
    // provide ordered select responses used by the route and formatInvitation
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTeam])) }) ) })) // team (initial)
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockStudentProfile])) }) ) })) // studentProfile
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ count: 0 }])) }) ) })) // getTeamMemberCount
    // existing membership check -> none
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) }) ) })) // existing membership (invitedUserId)
    // pendingForTeam -> none
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) }) ) })) // pending invitations
    // after insert: teamMembers for reviewers
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ userId: 1 }])) }) ) })) // teamMembers list
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockCandidateUser])) }) ) })) // candidateUser
    // formatInvitation selects: team, invitedUser, invitedBy, leader, member count
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockTeam])) }) ) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([mockCandidateUser])) }) ) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ id: 1, name: 'Leader', email: 'l@example.com', role: 'leader', createdAt: new Date().toISOString() }])) }) ) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ id: 1, name: 'Leader', email: 'l@example.com', role: 'leader', createdAt: new Date().toISOString() }])) }) ) }))
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([{ count: 1 }])) }) ) }))

    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'leader', name: 'Leader' })

    const res = await request(app).post('/invitations').send({ teamId: 1, studentId: 'ABC123' })
    // debug output for failure
    if (res.status !== 201) console.error('INVITE ERR BODY:', res.status, res.body)
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('team')
  })
})
