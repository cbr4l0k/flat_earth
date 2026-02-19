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

type ConfigTab = 'account' | 'workspace' | 'activity' | 'notifications'

export const Route = createFileRoute('/_authed/boards')({
  component: BoardsRouteComponent,
})

function BoardsRouteComponent() {
  const navigate = useNavigate()
  const { activeAccount, activeBoards, accounts, setActiveAccountId } = useActiveAccount()
  const [selectedBoardId, setSelectedBoardId] = useState<Id<'boards'> | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [expandedCustomLaneId, setExpandedCustomLaneId] = useState<LaneId | null>(null)
  const [isCreatingCard, setIsCreatingCard] = useState(false)
  const [pendingNavigateCardId, setPendingNavigateCardId] = useState<Id<'cards'> | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [configTab, setConfigTab] = useState<ConfigTab>('account')

  const configPanelRef = useRef<HTMLDivElement | null>(null)
  const configButtonRef = useRef<HTMLButtonElement | null>(null)

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

  const shouldLoadActivity = isConfigOpen && configTab === 'activity'
  const shouldLoadNotifications = isConfigOpen && configTab === 'notifications'

  const events = useQuery(
    api.events.listRecent,
    accountId && shouldLoadActivity ? { accountId } : 'skip',
  )
  const notifications = useQuery(
    api.notifications.list,
    accountId && shouldLoadNotifications ? { accountId } : 'skip',
  )
  const unreadCount = useQuery(
    api.notifications.unreadCount,
    accountId && shouldLoadNotifications ? { accountId } : 'skip',
  )

  const moveToColumn = useMutation(api.cards.moveToColumn)
  const createCard = useMutation(api.cards.create)
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)

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
          map.maybe.push(card)
          continue
        }

        if (notNowId && card.columnId === notNowId) {
          map['not-now'].push(card)
          continue
        }

        if (doneId && card.columnId === doneId) {
          map.done.push(card)
          continue
        }

        const customLaneId = `column:${card.columnId}`
        map[customLaneId] = [...(map[customLaneId] ?? []), card]
      }
    }

    const normalizedFilter = filterQuery.trim().toLowerCase()
    if (!normalizedFilter) {
      return map
    }

    const filtered: Record<string, Array<CardDoc>> = {}
    for (const [laneId, laneCards] of Object.entries(map)) {
      filtered[laneId] = laneCards.filter((card) => {
        const searchable = `${card.title} #${card.number} ${card.description ?? ''}`.toLowerCase()
        return searchable.includes(normalizedFilter)
      })
    }

    return filtered
  }, [allCards, laneMap, filterQuery])

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

    setExpandedCustomLaneId((current) => {
      if (current && customLaneIds.includes(current)) {
        return current
      }
      return customLaneIds[0]
    })
  }, [customLaneIds, boardId])

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

  useEffect(() => {
    if (!isConfigOpen) return

    function onDocumentClick(event: MouseEvent) {
      const target = event.target as Node
      if (configPanelRef.current?.contains(target)) return
      if (configButtonRef.current?.contains(target)) return
      setIsConfigOpen(false)
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsConfigOpen(false)
      }
    }

    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('mousedown', onDocumentClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [isConfigOpen])

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

  const openConfigTab = useCallback((tab: ConfigTab) => {
    setConfigTab(tab)
    setIsConfigOpen(true)
  }, [])

  const onToggleCustomLane = useCallback((laneId: LaneId) => {
    if (!customLaneIds.includes(laneId)) return
    setExpandedCustomLaneId(laneId)
  }, [customLaneIds])

  const boardName = boards.find((board) => board._id === boardId)?.name ?? 'Board'

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  )

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
      <header className="board-topbar">
        <h1>{boardName}</h1>
        <div className="board-topbar-controls">
          <input
            type="search"
            className="board-filter"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter cards..."
            aria-label="Filter cards"
          />
          <button
            ref={configButtonRef}
            type="button"
            className="config-button"
            onClick={() => setIsConfigOpen((open) => !open)}
            aria-label="Open configuration panel"
            aria-expanded={isConfigOpen}
          >
            <span aria-hidden>⚙</span>
          </button>
        </div>
      </header>

      {mutationError ? <p className="field-error">{mutationError}</p> : null}

      <div className="board-main">
        <div className="lane-grid">
          {laneMap.map((lane) => {
            const isCustom = lane.kind === 'custom-column'
            const isExpanded =
              lane.kind === 'virtual-maybe' || (isCustom && lane.id === expandedCustomLaneId)
            const isRail = !isExpanded
            const laneCards = cardsByLane[lane.id] ?? []

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
                    onPointerDown={(event) => {
                      event.stopPropagation()
                    }}
                    onClick={() => {
                      if (!isCustom) return
                      onToggleCustomLane(lane.id)
                    }}
                    disabled={!isCustom}
                  >
                    <span className="lane-collapsed-count">{laneCards.length}</span>
                    <span className="lane-collapsed-title">{lane.title}</span>
                  </button>
                ) : (
                  <>
                    <header className="lane-header">
                      <h2>{lane.title}</h2>
                      <span>{laneCards.length}</span>
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
                      {laneCards.map((card) => (
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
                          <p className="lane-card-number">#{card.number}</p>
                          <div className="lane-card-metrics">
                            {card.isGolden ? <span>Gold</span> : null}
                            {card.dueOn ? <span>Due {card.dueOn}</span> : null}
                            {card.postponedAt ? <span>Postponed</span> : null}
                            {card.closedAt ? <span>Done</span> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>

        {isConfigOpen ? (
          <aside ref={configPanelRef} className="config-panel" aria-label="Configuration panel">
            <header className="config-panel-header">
              <h2>Configuration</h2>
              <button type="button" className="config-close" onClick={() => setIsConfigOpen(false)}>
                Close
              </button>
            </header>

            <div className="config-tabs" role="tablist" aria-label="Configuration views">
              <button
                type="button"
                role="tab"
                aria-selected={configTab === 'account'}
                className={configTab === 'account' ? 'config-tab config-tab-active' : 'config-tab'}
                onClick={() => openConfigTab('account')}
              >
                Account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={configTab === 'workspace'}
                className={configTab === 'workspace' ? 'config-tab config-tab-active' : 'config-tab'}
                onClick={() => openConfigTab('workspace')}
              >
                Workspace
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={configTab === 'activity'}
                className={configTab === 'activity' ? 'config-tab config-tab-active' : 'config-tab'}
                onClick={() => openConfigTab('activity')}
              >
                Activity
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={configTab === 'notifications'}
                className={configTab === 'notifications' ? 'config-tab config-tab-active' : 'config-tab'}
                onClick={() => openConfigTab('notifications')}
              >
                Notifications
              </button>
            </div>

            <div className="config-content">
              {configTab === 'account' ? (
                <div className="config-stack">
                  <label htmlFor="account-select">Account</label>
                  <select
                    id="account-select"
                    value={activeAccount._id}
                    onChange={(event) => {
                      setActiveAccountId(event.target.value as Id<'accounts'>)
                      setSelectedBoardId(null)
                    }}
                  >
                    {(accounts ?? []).map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.name}
                      </option>
                    ))}
                  </select>

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
              ) : null}

              {configTab === 'workspace' ? (
                <div className="config-stack config-copy">
                  <p>Weekly cadence keeps the board flowing with clear owner decisions.</p>
                  <p>Use Maybe for new cards, then drag into one current working column.</p>
                  <p>Not Now and Done stay protected to keep closure and postponement explicit.</p>
                </div>
              ) : null}

              {configTab === 'activity' ? (
                <ul className="config-list">
                  {events === undefined ? <li>Loading activity…</li> : null}
                  {events && events.length === 0 ? <li>No events yet.</li> : null}
                  {events?.map((event) => (
                    <li key={event._id}>
                      <p className="config-list-title">{event.action}</p>
                      <p className="config-list-meta">{dateFormatter.format(new Date(event._creationTime))}</p>
                    </li>
                  ))}
                </ul>
              ) : null}

              {configTab === 'notifications' ? (
                <div className="config-stack">
                  <div className="config-inline-row">
                    <p>{unreadCount ?? 0} unread</p>
                    <button
                      type="button"
                      className="config-inline-action"
                      onClick={() => {
                        if (!accountId) return
                        void markAllRead({ accountId })
                      }}
                    >
                      Mark all read
                    </button>
                  </div>
                  <ul className="config-list">
                    {notifications === undefined ? <li>Loading notifications…</li> : null}
                    {notifications && notifications.length === 0 ? <li>No notifications.</li> : null}
                    {notifications?.map((notification) => (
                      <li key={notification._id}>
                        <p className="config-list-title">{notification.source.type}</p>
                        <div className="config-inline-row">
                          <p className="config-list-meta">
                            {notification.readAt ? 'Read' : 'Unread'}
                          </p>
                          {!notification.readAt ? (
                            <button
                              type="button"
                              className="config-inline-action"
                              onClick={() => {
                                if (!accountId) return
                                void markRead({ accountId, notificationId: notification._id })
                              }}
                            >
                              Mark read
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
