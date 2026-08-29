export type Grade = 0 | 1 | 2 | 3 | 4 | 5

export interface SchedulingState {
  ease: number
  interval: number
  reps: number
}

export const scheduleReview = (state: SchedulingState, grade: Grade): SchedulingState => {
  let { ease, interval, reps } = state

  if (grade < 3) {
    reps = 0
    interval = 1
  } else {
    reps += 1
    if (reps === 1) {
      interval = 1
    } else if (reps === 2) {
      interval = 6
    } else {
      interval = Math.round(interval * ease)
    }
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
  }

  return { ease, interval, reps }
}

export const nextDueDate = (interval: number): Date =>
  new Date(Date.now() + interval * 86400000)
