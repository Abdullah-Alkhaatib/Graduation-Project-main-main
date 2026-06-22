const express = require('express')
const request = require('supertest')

// Mock session middleware to control req.user in tests
let mockUser: any = { id: 1, role: 'supervisor' }
jest.mock('../middlewares/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
  __setMockUser: (u: any) => { mockUser = u }
}))

// Mock the database module used by auth routes
const mockUpdatedUser = { id: 1, name: 'Sup', email: 'sup@example.com', studentId: null, gender: null, role: 'supervisor', officeHours: '2026-06-04T00:00:00.000Z', createdAt: new Date().toISOString() }
const dbMock = {
  select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
  insert: jest.fn(() => Promise.resolve([mockUpdatedUser])),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([mockUpdatedUser])) }))
    }))
  }))
}

jest.mock('@workspace/db', () => ({ db: dbMock, usersTable: {}, studentProfilesTable: {}, eq: (_a: any, _b: any) => ({}) }))

import router, { formatUser, generateStudentId } from './auth'

describe('auth helpers', () => {
  test('generateStudentId creates 6 uppercase alnum chars', () => {
    const id = generateStudentId()
    expect(id).toHaveLength(6)
    expect(/^[0-9A-Z]{6}$/.test(id)).toBe(true)
  })

  test('formatUser maps fields and nulls', () => {
    const u: any = { id: 2, name: 'S', email: 's@example.com', studentId: undefined, gender: undefined, role: 'student', officeHours: undefined, createdAt: '2020-01-01' }
    const out = formatUser(u)
    expect(out.studentId).toBeNull()
    expect(out.gender).toBeNull()
    expect(out.officeHours).toBeNull()
    expect(out).toMatchObject({ id: 2, name: 'S', email: 's@example.com', role: 'student' })
  })
})

describe('PUT /auth/me (supervisor office hours)', () => {
  let app: express.Express
  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(router)
  })

  test('returns 403 when user is not supervisor', async () => {
    // set mock user to student
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 3, role: 'student' })

    const res = await request(app).put('/auth/me').send({ officeHours: '2026-06-04T00:00:00Z' })
    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error')
  })

  test('returns 400 for invalid office hours', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'supervisor' })

    const res = await request(app).put('/auth/me').send({ officeHours: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  test('updates office hours for supervisor and returns formatted user', async () => {
    const session = require('../middlewares/auth')
    session.__setMockUser({ id: 1, role: 'supervisor' })

    const date = new Date().toISOString()
    const res = await request(app).put('/auth/me').send({ officeHours: date })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id')
    expect(res.body).toHaveProperty('officeHours')
  })
})
