import { buildDiscussionSchedule } from './discussion-scheduling'

describe('buildDiscussionSchedule', () => {
  test('throws when roomsCount < 1', async () => {
    const teams: any[] = [{ id: 1, name: 'A', supervisorId: 2 }]
    const supervisors: any[] = [{ id: 2 }]
    await expect(buildDiscussionSchedule(teams as any, supervisors as any, {
      startDate: '2026-06-01', endDate: '2026-06-01', workStartHour: '09:00', workEndHour: '10:00', discussionDuration: 60, breakDuration: 0, roomsCount: 0
    })).rejects.toThrow('Rooms count must be at least 1')
  })

  test('schedules simple case', async () => {
    const teams: any[] = [ { id: 1, name: 'Team A', supervisorId: 2 } ]
    const supervisors: any[] = [ { id: 2 }, { id: 3 }, { id: 4 } ]
    const result = await buildDiscussionSchedule(teams as any, supervisors as any, {
      startDate: '2026-06-01', endDate: '2026-06-01', workStartHour: '09:00', workEndHour: '12:00', discussionDuration: 30, breakDuration: 0, roomsCount: 1
    })
    expect(result.schedules.length).toBe(1)
    expect(result.overview.teamCount).toBe(1)
  })
})
