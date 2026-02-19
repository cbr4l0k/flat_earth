import { createFileRoute } from '@tanstack/react-router'
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
type CardDoc = Doc<'cards'>

export const Route = createFileRoute('/_authed/boards')({
  component: BoardsRouteComponent,
})

function BoardsRouteComponent() {
  const { activeAccount, activeBoards } = useActiveAccount()
  const [selectedBoardId, setSelectedBoardId] = useState<Id<'boards'> | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [expandedCustomLaneId, setExpandedCustomLaneId] = useState<LaneId | null>(null)
  const [isCreatingCard, setIsCreatingCard] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<Id<'cards'> | null>(null)
  const [cardTitleDraft, setCardTitleDraft] = useState('')
  const [cardDescriptionDraft, setCardDescriptionDraft] = useState('')
  const [isSavingCard, setIsSavingCard] = useState(false)

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
  const updateCard = useMutation(api.cards.update)

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

  const customLaneIds = useMemo(
    () => laneMap.filter((lane) => lane.id.startsWith('column:')).map((lane) => lane.id),
    [laneMap],
  )

  const cardsByLane = useMemo(() => {
    const map: Record<string, Array<CardDoc>> = {}
    laneMap.forEach((lane) => {
      map[lane.id] = []
    })

    if (allCards) {
      for (const card of allCards) {
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

  const publishedCardIds = useMemo(() => {
    if (!allCards) return ''
    return allCards
      .map((card) => card._id)
      .join('|')
  }, [allCards])

  const laneIds = useMemo(() => laneMap.map((lane) => lane.id).join('|'), [laneMap])

  const cardLookupRef = useRef(cardLookup)
  const laneMapRef = useRef(laneMap)
  const selectedCard = selectedCardId ? cardLookup.get(selectedCardId) ?? null : null

  useEffect(() => {
    cardLookupRef.current = cardLookup
  }, [cardLookup])

  useEffect(() => {
    laneMapRef.current = laneMap
  }, [laneMap])

  useEffect(() => {
    if (!selectedCard) {
      setCardTitleDraft('')
      setCardDescriptionDraft('')
      return
    }
    setCardTitleDraft(selectedCard.title)
    setCardDescriptionDraft(selectedCard.description ?? '')
  }, [selectedCard])

  useEffect(() => {
    if (customLaneIds.length === 0) {
      setExpandedCustomLaneId(null)
      return
    }
    if (!expandedCustomLaneId || !customLaneIds.includes(expandedCustomLaneId)) {
      setExpandedCustomLaneId(customLaneIds[0])
    }
  }, [customLaneIds, expandedCustomLaneId, boardId])

  const dropCardIntoLane = useCallback(async (cardId: Id<'cards'>, targetLaneId: LaneId) => {
    if (!boardId || !accountId) return

    const card = cardLookupRef.current.get(cardId)
    if (!card) return

    setMutationError(null)

    try {
      if (targetLaneId === 'maybe') {
        await moveToColumn({ accountId, cardId: card._id, columnId: null })
      } else if (targetLaneId === 'not-now' || targetLaneId === 'done') {
        const protectedColumnId = laneMapRef.current.find(
          (lane) => lane.id === targetLaneId,
        )?.columnId
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
    }
  }, [accountId, boardId, moveToColumn])

  const createCardInMaybe = useCallback(async () => {
    if (!accountId || !boardId) return
    setIsCreatingCard(true)
    setMutationError(null)
    try {
      const cardId = await createCard({ accountId, boardId, title: '' })
      setSelectedCardId(cardId)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to create card')
    } finally {
      setIsCreatingCard(false)
    }
  }, [accountId, boardId, createCard])

  const saveSelectedCard = useCallback(async () => {
    if (!accountId || !selectedCardId) return
    setIsSavingCard(true)
    setMutationError(null)
    try {
      await updateCard({
        accountId,
        cardId: selectedCardId,
        title: cardTitleDraft,
        description: cardDescriptionDraft,
      })
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to save card')
    } finally {
      setIsSavingCard(false)
    }
  }, [accountId, selectedCardId, updateCard, cardTitleDraft, cardDescriptionDraft])

  useEffect(() => {
    if (!accountId || !boardId) return

    const cleanupFns: Array<() => void> = []
    const cardElements = document.querySelectorAll<HTMLElement>('[data-card-id]')
    const laneElements = document.querySelectorAll<HTMLElement>('[data-lane-id]')

    for (const element of cardElements) {
      const cardId = element.dataset.cardId as Id<'cards'> | undefined
      if (!cardId) continue

      cleanupFns.push(
        draggable({
          element,
          getInitialData: () => ({ type: 'card', cardId }),
        }),
      )
    }

    for (const element of laneElements) {
      const laneId = element.dataset.laneId
      if (!laneId) continue

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
          const laneId = location.current.dropTargets[0]?.data.laneId as
            | LaneId
            | undefined

          if (!cardId || !laneId) return
          void dropCardIntoLane(cardId, laneId)
        },
      }),
    )

    return () => {
      cleanupFns.forEach((cleanup) => cleanup())
    }
  }, [accountId, boardId, laneIds, publishedCardIds, dropCardIntoLane])

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
      <header className="page-header">
        <p className="page-eyebrow">Boards</p>
        <h1>Boards</h1>
        <p>
          One-click card creation goes to Maybe. Only one working column stays expanded;
          Not Now and Done remain protected collapsed rails.
        </p>
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
          {laneMap.map((lane) => (
            (() => {
            const isCustom = lane.id.startsWith('column:')
            const isExpanded = lane.id === 'maybe' || (isCustom && lane.id === expandedCustomLaneId)
            const isCollapsedRail = !isExpanded

            return (
              <section
                key={lane.id}
                data-lane-id={lane.id}
                className={[
                  'lane',
                  lane.isProtected ? 'lane-protected' : '',
                  lane.id === 'maybe' ? 'lane-maybe' : '',
                  isExpanded ? 'lane-expanded' : 'lane-collapsed',
                ].join(' ')}
              >
                {isCollapsedRail ? (
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
                      <p>{lane.subtitle}</p>
                      <span>{cardsByLane[lane.id].length}</span>
                      {lane.id === 'maybe' ? (
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
                      {cardsByLane[lane.id].map((card) => (
                        <article
                          key={card._id}
                          data-card-id={card._id}
                          className="lane-card"
                          onClick={() => setSelectedCardId(card._id)}
                        >
                          <h3>{card.title || `Card #${card.number}`}</h3>
                          <p>#{card.number}</p>
                        </article>
                      ))}
                    </div>

                    {lane.isVirtual ? (
                      <p className="lane-note">Virtual triage lane.</p>
                    ) : null}
                  </>
                )}
              </section>
            )
            })()
          ))}
        </div>

        <aside className="card-editor">
          <header className="card-editor-header">
            <h2>Card Editor</h2>
            <p>{selectedCard ? `#${selectedCard.number}` : 'Select a card to edit'}</p>
          </header>

          <label htmlFor="card-title">Title</label>
          <input
            id="card-title"
            value={cardTitleDraft}
            onChange={(event) => setCardTitleDraft(event.target.value)}
            disabled={!selectedCard || isSavingCard}
            placeholder="Card title"
          />

          <label htmlFor="card-description">Description</label>
          <textarea
            id="card-description"
            value={cardDescriptionDraft}
            onChange={(event) => setCardDescriptionDraft(event.target.value)}
            disabled={!selectedCard || isSavingCard}
            rows={8}
            placeholder="Add details, decisions, and next actions"
          />

          <div className="card-editor-actions">
            <button
              type="button"
              className="text-action"
              onClick={() => void saveSelectedCard()}
              disabled={!selectedCard || isSavingCard}
            >
              {isSavingCard ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
