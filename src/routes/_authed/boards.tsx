import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Doc, Id } from 'convex/_generated/dataModel'
import { useActiveAccount } from '~/utils/useActiveAccount'

type LaneId = string

type Lane = {
  id: LaneId
  title: string
  kind: 'protected-not-now' | 'virtual-maybe' | 'custom-column' | 'protected-done'
  columnId?: Id<'columns'>
}

type CardDoc = Doc<'cards'>

export const Route = createFileRoute('/_authed/boards')({
  component: BoardsRouteComponent,
})

function BoardsRouteComponent() {
  const navigate = useNavigate()
  const { activeAccount, activeBoards } = useActiveAccount()
  const [selectedBoardId, setSelectedBoardId] = useState<Id<'boards'> | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [expandedCustomLaneId, setExpandedCustomLaneId] = useState<LaneId | null>(null)
  const [isCreatingCard, setIsCreatingCard] = useState(false)
  const [pendingNavigateCardId, setPendingNavigateCardId] = useState<Id<'cards'> | null>(null)

  const accountId = activeAccount?._id
  const boards = useMemo(
    () => (activeBoards ?? []).filter((board): board is NonNullable<typeof board> => board !== null),
    [activeBoards],
  )
  const boardId: Id<'boards'> | undefined = selectedBoardId ?? boards[0]?._id

  const columns = useQuery(
    api.columns.listByBoard,
    accountId && boardId ? { accountId, boardId } : 'skip',
  )
  const allCards = useQuery(
    api.cards.listByBoard,
    accountId && boardId ? { accountId, boardId } : 'skip',
  )

  const moveToColumn = useMutation(api.cards.moveToColumn)
  const createCard = useMutation(api.cards.create)

  const laneMap = useMemo<Array<Lane>>(() => {
    if (!columns) return []

    const sorted = [...columns].sort((a, b) => a.position - b.position)
    const notNow = sorted.find((column) => column.name.toLowerCase() === 'not now')
    const done = sorted.find((column) => column.name.toLowerCase() === 'done')
    const customColumns = sorted.filter(
      (column) => !column.protected && column._id !== notNow?._id && column._id !== done?._id,
    )

    return [
      {
        id: 'not-now',
        title: 'Not Now',
        kind: 'protected-not-now',
        columnId: notNow?._id,
      },
      {
        id: 'maybe',
        title: 'Maybe',
        kind: 'virtual-maybe',
      },
      ...customColumns.map((column) => ({
        id: `column:${column._id}`,
        title: column.name,
        kind: 'custom-column' as const,
        columnId: column._id,
      })),
      {
        id: 'done',
        title: 'Done',
        kind: 'protected-done',
        columnId: done?._id,
      },
    ]
  }, [columns])

  const customLaneIds = useMemo(
    () => laneMap.filter((lane) => lane.kind === 'custom-column').map((lane) => lane.id),
    [laneMap],
  )

  const cardsByLane = useMemo(() => {
    const map: Record<string, Array<CardDoc>> = {}
    for (const lane of laneMap) map[lane.id] = []

    if (allCards) {
      const notNowId = laneMap.find((lane) => lane.kind === 'protected-not-now')?.columnId
      const doneId = laneMap.find((lane) => lane.kind === 'protected-done')?.columnId

      for (const card of allCards) {
        if (card.columnId === null) {
          map.maybe = [...map.maybe, card]
          continue
        }

        if (notNowId && card.columnId === notNowId) {
          map['not-now'] = [...map['not-now'], card]
          continue
        }

        if (doneId && card.columnId === doneId) {
          map.done = [...map.done, card]
          continue
        }

        const customLaneId = `column:${card.columnId}`
        map[customLaneId] = [...(map[customLaneId] ?? []), card]
      }
    }

    return map
  }, [allCards, laneMap])

  const cardLookup = useMemo(() => {
    const lookup = new Map<Id<'cards'>, CardDoc>()
    for (const card of allCards ?? []) {
      lookup.set(card._id, card)
    }
    return lookup
  }, [allCards])

  const cardLookupRef = useRef(cardLookup)
  const laneMapRef = useRef(laneMap)
  const cardElementsRef = useRef(new Map<string, HTMLElement>())
  const laneElementsRef = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    cardLookupRef.current = cardLookup
  }, [cardLookup])

  useEffect(() => {
    laneMapRef.current = laneMap
  }, [laneMap])

  useEffect(() => {
    if (customLaneIds.length === 0) {
      setExpandedCustomLaneId(null)
      return
    }
    if (!expandedCustomLaneId || !customLaneIds.includes(expandedCustomLaneId)) {
      setExpandedCustomLaneId(customLaneIds[0])
    }
  }, [customLaneIds, expandedCustomLaneId, boardId])

  useEffect(() => {
    if (!pendingNavigateCardId) return
    const created = cardLookup.get(pendingNavigateCardId)
    if (!created) return

    setPendingNavigateCardId(null)
    void navigate({
      to: '/cards/$number',
      params: { number: String(created.number) },
    })
  }, [cardLookup, navigate, pendingNavigateCardId])

  const getCardLaneId = useCallback(
    (card: CardDoc): LaneId => {
      if (card.columnId === null) return 'maybe'

      const notNowId = laneMapRef.current.find((lane) => lane.kind === 'protected-not-now')?.columnId
      const doneId = laneMapRef.current.find((lane) => lane.kind === 'protected-done')?.columnId

      if (notNowId && card.columnId === notNowId) return 'not-now'
      if (doneId && card.columnId === doneId) return 'done'
      return `column:${card.columnId}`
    },
    [],
  )

  const dropCardIntoLane = useCallback(
    async (cardId: Id<'cards'>, targetLaneId: LaneId) => {
      if (!boardId || !accountId) return

      const card = cardLookupRef.current.get(cardId)
      if (!card) return

      const currentLaneId = getCardLaneId(card)
      if (currentLaneId === targetLaneId) return

      setMutationError(null)

      try {
        if (targetLaneId === 'maybe') {
          await moveToColumn({ accountId, cardId: card._id, columnId: null })
          return
        }

        const targetLane = laneMapRef.current.find((lane) => lane.id === targetLaneId)
        if (!targetLane) return

        if (!targetLane.columnId) {
          throw new Error(`Lane "${targetLane.title}" is not configured`)
        }

        await moveToColumn({
          accountId,
          cardId: card._id,
          columnId: targetLane.columnId,
        })
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : 'Card move failed')
      }
    },
    [accountId, boardId, getCardLaneId, moveToColumn],
  )

  const createCardInMaybe = useCallback(async () => {
    if (!accountId || !boardId) return

    setIsCreatingCard(true)
    setMutationError(null)

    try {
      const cardId = await createCard({ accountId, boardId, title: '' })
      setPendingNavigateCardId(cardId)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to create card')
    } finally {
      setIsCreatingCard(false)
    }
  }, [accountId, boardId, createCard])

  const setCardElement = useCallback((cardId: string, node: HTMLElement | null) => {
    if (node) {
      cardElementsRef.current.set(cardId, node)
      return
    }
    cardElementsRef.current.delete(cardId)
  }, [])

  const setLaneElement = useCallback((laneId: string, node: HTMLElement | null) => {
    if (node) {
      laneElementsRef.current.set(laneId, node)
      return
    }
    laneElementsRef.current.delete(laneId)
  }, [])

  const cardIdsKey = useMemo(() => (allCards ?? []).map((card) => card._id).join('|'), [allCards])
  const laneIdsKey = useMemo(() => laneMap.map((lane) => lane.id).join('|'), [laneMap])

  useEffect(() => {
    if (!accountId || !boardId) return

    const cleanupFns: Array<() => void> = []

    for (const [cardId, element] of cardElementsRef.current.entries()) {
      cleanupFns.push(
        draggable({
          element,
          getInitialData: () => ({ type: 'card', cardId }),
        }),
      )
    }

    for (const [laneId, element] of laneElementsRef.current.entries()) {
      cleanupFns.push(
        dropTargetForElements({
          element,
          getData: () => ({ laneId }),
        }),
      )
    }

    cleanupFns.push(
      monitorForElements({
        onDrop: ({ source, location }) => {
          const cardId = source.data.cardId as Id<'cards'> | undefined
          if (!cardId) return

          const dropTarget = location.current.dropTargets.find((target) => {
            return typeof target.data.laneId === 'string'
          })

          const laneId = dropTarget?.data.laneId as LaneId | undefined
          if (!laneId) return

          void dropCardIntoLane(cardId, laneId)
        },
      }),
    )

    return () => {
      cleanupFns.forEach((cleanup) => cleanup())
    }
  }, [accountId, boardId, cardIdsKey, laneIdsKey, dropCardIntoLane])

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

  if (columns === undefined || allCards === undefined) {
    return (
      <section className="board-page">
        <header className="page-header">
          <h1>Boards</h1>
          <p>Loading board workspace…</p>
        </header>
      </section>
    )
  }

  return (
    <section className="board-page">
      <header className="page-header board-header-simple">
        <h1>{boards.find((board) => board._id === boardId)?.name ?? 'Board'}</h1>
      </header>

      <div className="board-toolbar">
        <label htmlFor="board-select">Board</label>
        <select
          id="board-select"
          value={boardId || ''}
          onChange={(event) => setSelectedBoardId(event.target.value as Id<'boards'>)}
        >
          {boards.map((board) => (
            <option key={board._id} value={board._id}>
              {board.name}
            </option>
          ))}
        </select>
      </div>

      {mutationError ? <p className="field-error">{mutationError}</p> : null}

      <div className="board-main">
        <div className="lane-grid">
          {laneMap.map((lane) => {
            const isCustom = lane.kind === 'custom-column'
            const isExpanded =
              lane.kind === 'virtual-maybe' || (isCustom && lane.id === expandedCustomLaneId)
            const isRail = !isExpanded

            return (
              <section
                key={lane.id}
                ref={(node) => setLaneElement(lane.id, node)}
                data-lane-id={lane.id}
                className={[
                  'lane',
                  isExpanded ? 'lane-expanded' : 'lane-collapsed',
                  lane.kind.startsWith('protected-') ? 'lane-protected' : '',
                  lane.kind === 'virtual-maybe' ? 'lane-maybe' : '',
                ].join(' ')}
              >
                {isRail ? (
                  <button
                    type="button"
                    className="lane-collapsed-toggle"
                    onClick={() => {
                      if (!isCustom) return
                      setExpandedCustomLaneId(lane.id)
                    }}
                    disabled={!isCustom}
                  >
                    <span className="lane-collapsed-count">{cardsByLane[lane.id].length}</span>
                    <span className="lane-collapsed-title">{lane.title}</span>
                  </button>
                ) : (
                  <>
                    <header className="lane-header">
                      <h2>{lane.title}</h2>
                      <span>{cardsByLane[lane.id].length}</span>
                      {lane.kind === 'virtual-maybe' ? (
                        <button
                          type="button"
                          className="lane-add-card"
                          onClick={() => void createCardInMaybe()}
                          disabled={isCreatingCard}
                        >
                          {isCreatingCard ? 'Creating…' : 'Add a card'}
                        </button>
                      ) : null}
                    </header>

                    <div className="lane-cards">
                      {(cardsByLane[lane.id] ?? []).map((card) => (
                        <article
                          key={card._id}
                          ref={(node) => setCardElement(card._id, node)}
                          data-card-id={card._id}
                          className="lane-card"
                          onClick={() =>
                            void navigate({
                              to: '/cards/$number',
                              params: { number: String(card.number) },
                            })
                          }
                        >
                          <h3>{card.title || `Card #${card.number}`}</h3>
                          <p>#{card.number}</p>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
