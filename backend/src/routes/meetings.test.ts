const express = require('express')
const request = require('supertest')

let mockUser: any = { id: 1, role: 'leader' }
jest.mock('../middlewares/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
  __setMockUser: (u: any) => { mockUser = u }
}))

const membership = { teamId: 5, userId: 1, role: 'leader' }
const team = { id: 5, name: 'T', supervisorId: 2 }
const supervisor = { id: 2, officeHours: new Date().toISOString() }
const meeting = { id: 11, teamId: 5, requestedById: 1, supervisorId: 2, proposedDate: new Date().toISOString(), status: 'pending' }

const dbMock = {
  select: jest.fn(),
  insert: jest.fn(() => Promise.resolve([meeting])),
}

// implement select mock behaviors in tests
jest.mock('@workspace/db', () => ({ db: dbMock, usersTable: {}, teamsTable: {}, meetingsTable: {}, teamMembersTable: {}, eq: (_a: any, _b: any) => ({}) }))

import router from './meetings'

describe('POST /meetings', () => {
  let app: any
  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(router)
    dbMock.select.mockReset()
  })

  test('only leader can request -> 403', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'student' })

    // membership exists but role is not leader
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([ { teamId: 5, userId: 1, role: 'member' } ])) })) }))

    const res = await request(app).post('/meetings').send({ supervisorId: 2, proposedDate: new Date().toISOString() })
    expect(res.status).toBe(403)
  })

  test('successful meeting request when leader and valid slot', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'leader' })

    // membership
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([membership])) })) }))
    // team
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([team])) })) }))
    // supervisor office hours
    dbMock.select.mockImplementationOnce(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([supervisor])) })) }))
    dbMock.insert.mockImplementationOnce(() => Promise.resolve([meeting]))

    const res = await request(app).post('/meetings').send({ supervisorId: 2, proposedDate: supervisor.officeHours })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('team')
  })
})
