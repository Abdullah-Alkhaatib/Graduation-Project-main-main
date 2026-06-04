import { cn } from './utils'

describe('cn helper', () => {
  it('merges Tailwind classes and removes duplicates', () => {
    expect(cn('text-sm', 'font-bold', 'text-sm')).toBe('font-bold text-sm')
  })

  it('allows falsy values to be ignored', () => {
    expect(cn('px-4', false && 'hidden', undefined, 'bg-white')).toBe('px-4 bg-white')
  })
})
