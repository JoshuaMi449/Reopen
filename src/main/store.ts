// 配置存储模块：项目清单的 JSON 持久化
// 存到 app.getPath('userData') = ~/Library/Application Support/Reopen/（PRD 四·数据）
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { NewProjectInput, Project } from '../shared/types'

let projects: Project[] = []
let loaded = false

function dataFile(): string {
  return join(app.getPath('userData'), 'projects.json')
}

export function listProjects(): Project[] {
  if (loaded) return projects
  try {
    if (existsSync(dataFile())) {
      projects = JSON.parse(readFileSync(dataFile(), 'utf-8'))
    }
  } catch (err) {
    console.error('读取 projects.json 失败，按空列表继续：', err)
    projects = []
  }
  loaded = true
  return projects
}

function persist(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dataFile(), JSON.stringify(projects, null, 2), 'utf-8')
}

export function addProject(input: NewProjectInput): Project {
  const project: Project = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now()
  }
  projects.push(project)
  persist()
  return project
}

export function deleteProject(id: string): void {
  projects = projects.filter((p) => p.id !== id)
  persist()
}

export function touchStartedAt(id: string): void {
  const p = projects.find((p) => p.id === id)
  if (p) {
    p.lastStartedAt = Date.now()
    persist()
  }
}
