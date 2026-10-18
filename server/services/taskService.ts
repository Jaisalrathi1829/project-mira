import { ISODate, addDays } from '../../shared/dates'
import { TaskQuery, evaluate, queryTasks } from '../../shared/engine'
import type { ApiTask, CreateTaskInput, Task, UpdateTaskInput } from '../../shared/types'
import { transaction } from '../db/database'
import { conflict, invalid, notFound } from '../errors'
import { ServiceContext, clockOf } from './context'

export class TaskService {
  constructor(private readonly ctx: ServiceContext) {}

  private get repo() { return this.ctx.repos.tasks }
  private stamp() { return this.ctx.now().toISOString() }

  view(t: Task, today?: ISODate): ApiTask {
    return { ...t, computed: evaluate(t, clockOf(this.ctx, today)) }
  }

  private require(id: string): Task {
    const t = this.repo.get(id)
    if (!t) throw notFound('Task')
    return t
  }

  private fresh(id: string) {
    return this.view(this.require(id))
  }

  list(query: TaskQuery & { today?: ISODate }): ApiTask[] {
    const clock = clockOf(this.ctx, query.today)
    return queryTasks(this.repo.list(), query, clock).map((t) => ({ ...t, computed: evaluate(t, clock) }))
  }

  get(id: string, today?: ISODate) {
    return this.view(this.require(id), today)
  }

  create(input: CreateTaskInput): ApiTask {
    const prefs = this.ctx.repos.preferences.get()
    const startDate = input.startDate ?? clockOf(this.ctx).today
    const deadline = input.deadline ?? addDays(startDate, input.durationDays ?? prefs.defaultDuration)
    if (deadline < startDate) throw invalid('The deadline cannot be before the start date.', [{ path: 'deadline', message: 'Must be on or after startDate' }])
    if (input.source && input.sourceRef && this.repo.findBySource(input.source, input.sourceRef)) throw conflict('This item has already been added to MIRA.')
    const at = this.stamp()
    const id = transaction(this.ctx.db, () => this.repo.insert({
      title: input.title, description: input.description ?? '', startDate, deadline,
      priority: input.priority ?? 'Medium', reminder: input.reminder ?? prefs.reminder,
      source: input.source ?? null, sourceRef: input.sourceRef ?? null, count: input.count ?? null, completedAt: null,
    }, input.subtasks ?? [], at))
    return this.fresh(id)
  }

  update(id: string, patch: UpdateTaskInput): ApiTask {
    const t = this.require(id)
    const startDate = patch.startDate ?? t.startDate
    const deadline = patch.deadline ?? (patch.durationDays !== undefined ? addDays(startDate, patch.durationDays) : t.deadline)
    if (deadline < startDate) throw invalid('The deadline cannot be before the start date.', [{ path: 'deadline', message: 'Must be on or after startDate' }])
    this.repo.update(id, {
      title: patch.title, description: patch.description, priority: patch.priority, reminder: patch.reminder, count: patch.count,
      startDate: startDate === t.startDate ? undefined : startDate, deadline: deadline === t.deadline ? undefined : deadline,
    }, this.stamp())
    return this.fresh(id)
  }

  remove(id: string) {
    if (!this.repo.delete(id)) throw notFound('Task')
  }

  /** Sets the completion time once; completing an already-completed task changes nothing. */
  complete(id: string): ApiTask {
    const t = this.require(id)
    if (!t.completed) this.repo.update(id, { completedAt: this.stamp() }, this.stamp())
    return this.fresh(id)
  }

  reopen(id: string): ApiTask {
    const t = this.require(id)
    if (t.completed) this.repo.update(id, { completedAt: null }, this.stamp())
    return this.fresh(id)
  }

  stepCount(id: string, by: number): ApiTask {
    const t = this.require(id)
    if (!t.count) throw conflict('This task is not tracked by count.')
    this.repo.stepCount(id, by, this.stamp())
    return this.fresh(id)
  }

  addSubtask(id: string, title: string): ApiTask {
    this.require(id)
    const at = this.stamp()
    transaction(this.ctx.db, () => {
      this.repo.insertSubtask(id, title, at)
      this.repo.touch(id, at)
    })
    return this.fresh(id)
  }

  updateSubtask(id: string, subtaskId: string, patch: { title?: string; done?: boolean; position?: number }): ApiTask {
    this.require(id)
    const s = this.repo.getSubtask(id, subtaskId)
    if (!s) throw notFound('Subtask')
    const at = this.stamp()
    const doneChanged = patch.done !== undefined && patch.done !== s.done
    transaction(this.ctx.db, () => {
      this.repo.updateSubtask(id, subtaskId, { title: patch.title, ...(doneChanged ? { done: patch.done, completedAt: patch.done ? at : null } : {}) }, at)
      if (patch.position !== undefined) this.repo.reorderSubtasks(id, { id: subtaskId, to: patch.position })
      this.repo.touch(id, at)
    })
    return this.fresh(id)
  }

  removeSubtask(id: string, subtaskId: string): ApiTask {
    this.require(id)
    const at = this.stamp()
    transaction(this.ctx.db, () => {
      if (!this.repo.deleteSubtask(id, subtaskId)) throw notFound('Subtask')
      this.repo.reorderSubtasks(id)
      this.repo.touch(id, at)
    })
    return this.fresh(id)
  }
}
