import React from 'react'
import {Check, CircleAlert, LoaderCircle} from 'lucide-react'
import './AgentMessage.css'

const inlinePattern = /(!?\[([^\]\n]+)\]\(([^()\s]+)\))|(\*\*([^*\n]+)\*\*)|(`([^`\n]+)`)|(\*([^*\n]+)\*)/g
const listLine = /^\s*(- |\* |\d+\. )(.+)$/

function inline(line) {
  const parts = []
  let cursor = 0
  for (const match of line.matchAll(inlinePattern)) {
    const [raw, link, label, url, , bold, , code, , italic] = match
    parts.push(line.slice(cursor, match.index))
    const key = match.index
    if (bold) parts.push(<strong key={key}>{bold}</strong>)
    else if (code) parts.push(<code key={key}>{code}</code>)
    else if (italic) parts.push(<em key={key}>{italic}</em>)
    else if (link && !raw.startsWith('!') && /^https?:\/\//i.test(url)) {
      parts.push(<a key={key} href={url} target="_blank" rel="noreferrer">{label}</a>)
    } else parts.push(label)
    cursor = match.index + raw.length
  }
  parts.push(line.slice(cursor))
  return parts
}

export function AgentMessage({text, kind, pending = false}) {
  const lines = text.trim().split(/\r?\n/)
  const content = []
  for (let index = 0; index < lines.length;) {
    const key = index
    const line = lines[index++]
    if (!line.trim()) continue
    const item = line.match(listLine)
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (item) {
      const ordered = /^\d/.test(item[1])
      const items = [item[2]]
      while (index < lines.length) {
        const next = lines[index].match(listLine)
        if (!next || /^\d/.test(next[1]) !== ordered) break
        items.push(next[2])
        index += 1
      }
      const List = ordered ? 'ol' : 'ul'
      content.push(<List key={key}>{items.map((value, position) => <li key={position}>{inline(value)}</li>)}</List>)
    } else if (heading) content.push(<p className="agent-markdown-heading" key={key}>{inline(heading[1])}</p>)
    else content.push(<p key={key}>{inline(line)}</p>)
  }
  return <div className="agent-markdown" data-pending={pending || undefined}>
    {content}
    {kind === 'general' && <small className="agent-answer-label">General knowledge · verify before relying</small>}
  </div>
}

export function AgentToolStatus({tools, running = false}) {
  if (!tools.length) return null
  const unavailable = tools.filter(tool => tool.status === 'fallback').length
  const complete = tools.filter(tool => tool.status === 'done').length
  const items = <ul>{tools.map(tool => {
    const inProgress = tool.status === 'running'
    const fallback = tool.status === 'fallback'
    const StatusIcon = inProgress ? LoaderCircle : fallback ? CircleAlert : Check
    return <li key={tool.id || tool.name} data-tool-state={tool.status}><StatusIcon size={16} aria-hidden="true"/>
      <span>{tool.name}</span><small>{inProgress ? 'Checking' : fallback ? 'Unavailable' : 'Complete'}</small>
    </li>
  })}</ul>
  return running ? <div className="agent-tool-status" aria-label="Current lookups">{items}</div> : <details className="agent-tool-status">
    <summary>Lookup activity · {complete} completed{unavailable > 0 && ` · ${unavailable} unavailable`}</summary>{items}
  </details>
}
