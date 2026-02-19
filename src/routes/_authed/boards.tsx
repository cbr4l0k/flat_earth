import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import type { Doc, Id } from 'convex/_generated/dataModel'
import { useActiveAccount } from '~/utils/useActiveAccount'

type LaneId = string
type CardDoc = Doc<'cards'>

export const Route = createFileRoute('/_authed/boards')({
  component: BoardsRouteComponent,
})

function BoardsRouteComponent() {
  const { activeAccount } = useActiveAccount()
  const [selectedBoardId, setSelectedBoardId] = useState<Id<'boards'> | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<Id<'cards'> | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const accountId = activeAccount?._id
  const boards = useQuery(api.boards.list, accountId ? { accountId } : 'skip')
  const boardId = selectedBoardId ?? boards?.[0]?._id ?? null

  const columns = useQuery(
    api.columns.listByBoard,
    accountId && boardId ? { accountId, boardId } : 'skip',
  )
  const allCards = useQuery(
    api.cards.listByBoard,
    accountId && boardId ? { accountId, boardId } : 'skip',
  )

  const moveToColumn = useMutation(api.cards.moveToColumn)

  const laneMap = useMemo(() => {
    if (!columns) return []

    const customColumns = columns
      .filter((column) => !column.protected)
      .sort((a, b) => a.position - b.position)
    const notNow = columns.find((column) => column.name.toLowerCase() === 'not now')
    const done = columns.find((column) => column.name.toLowerCase() === 'done')

    const lanes: Array<{
      id: LaneId
      title: string
      subtitle: string
      isVirtual?: boolean
      isProtected?: boolean
      columnId?: string
    }> = [
      {
        id: 'maybe',
        title: 'Maybe',
        subtitle: 'Virtual triage lane (cards with no column)',
        isVirtual: true,
      },
      ...customColumns.map((column) => ({
        id: `column:${column._id}`,
        title: column.name,
        subtitle: 'Custom workflow column',
        columnId: column._id,
      })),
      {
        id: 'not-now',
        title: 'Not Now',
        subtitle: 'Protected system lane',
        isProtected: true,
        columnId: notNow?._id,
      },
      {
        id: 'done',
        title: 'Done',
        subtitle: 'Protected system lane',
        isProtected: true,
        columnId: done?._id,
      },
    ]

    return lanes
  }, [columns])

  const cardsByLane = useMemo(() => {
    const map: Record<string, Array<CardDoc>> = {}
    laneMap.forEach((lane) => {
      map[lane.id] = []
    })

    if (allCards) {
      for (const card of allCards) {
        if (card.status !== 'published') {
          continue
        }
        if (card.columnId === null) {
          map.maybe = [...map.maybe, card]
          continue
        }
        const laneId = `column:${card.columnId}`
        map[laneId] = [...(map[laneId] ?? []), card]
      }
    }
    return map
  }, [laneMap, allCards])

  const cardLookup = useMemo(() => {
    const all = [...(allCards ?? [])]
    const lookup = new Map<Id<'cards'>, CardDoc>()
    all.forEach((card) => {
      lookup.set(card._id, card)
    })
    return lookup
  }, [allCards])

  if (!activeAccount) {
    return (
      <section className="board-page">
        <header className="page-header">
          <h1>Boards</h1>
          <p>No active account yet.</p>
        </header>
      </section>
    )
  }

  if (boards === undefined || columns === undefined || allCards === undefined) {
    return (
      <section className="board-page">
        <header className="page-header">
          <h1>Boards</h1>
          <p>Loading board workspace…</p>
        </header>
      </section>
    )
  }

  async function dropIntoLane(targetLaneId: LaneId) {
    if (!draggingCardId || !boardId || !accountId) return

    const card = cardLookup.get(draggingCardId)
    if (!card) return

    setMutationError(null)

    try {
      if (targetLaneId === 'maybe') {
        await moveToColumn({ accountId, cardId: card._id, columnId: null })
      } else if (targetLaneId === 'not-now' || targetLaneId === 'done') {
        const protectedColumnId = laneMap.find((lane) => lane.id === targetLaneId)?.columnId
        if (!protectedColumnId) {
          throw new Error('Protected lane is not configured on this board')
        }
        await moveToColumn({
          accountId,
          cardId: card._id,
          columnId: protectedColumnId as Id<'columns'>,
        })
      } else if (targetLaneId.startsWith('column:')) {
        const columnId = targetLaneId.replace('column:', '')
        await moveToColumn({ accountId, cardId: card._id, columnId: columnId as Id<'columns'> })
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Card move failed')
    } finally {
      setDraggingCardId(null)
    }
  }

  return (
    <section className="board-page">
      <header className="page-header">
        <h1>Boards</h1>
        <p>
          Maybe is virtual. Not Now and Done are protected columns. Drag cards
          across lanes to update status.
        </p>
      </header>

      <div className="board-toolbar">
        <label htmlFor="board-select">Board</label>
        <select
          id="board-select"
          value={boardId ?? ''}
          onChange={(event) => setSelectedBoardId(event.target.value as Id<'boards'>)}
        >
          {boards
            .filter((board): board is NonNullable<typeof board> => board !== null)
            .map((board) => (
              <option key={board._id} value={board._id}>
                {board.name}
              </option>
            ))}
        </select>
      </div>

      {mutationError ? <p className="field-error">{mutationError}</p> : null}

      <div className="lane-grid">
        {laneMap.map((lane) => (
          <section
            key={lane.id}
            className={`lane ${lane.isProtected ? 'lane-protected' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropIntoLane(lane.id)}
          >
            <header className="lane-header">
              <h2>{lane.title}</h2>
              <p>{lane.subtitle}</p>
              <span>{cardsByLane[lane.id].length}</span>
            </header>

            <div className="lane-cards">
              {cardsByLane[lane.id].map((card) => (
                <article
                  key={card._id}
                  className="lane-card"
                  draggable
                  onDragStart={() => setDraggingCardId(card._id)}
                  onDragEnd={() => setDraggingCardId(null)}
                >
                  <h3>{card.title || `Card #${card.number}`}</h3>
                  <p>#{card.number}</p>
                </article>
              ))}
            </div>

            {lane.isVirtual ? (
              <p className="lane-note">Placeholder lane, not persisted as a column.</p>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  )
}
