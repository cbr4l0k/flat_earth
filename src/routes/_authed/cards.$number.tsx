import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from 'convex/_generated/api'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useActiveAccount } from '~/utils/useActiveAccount'

export const Route = createFileRoute('/_authed/cards/$number')({
  component: CardDetailRouteComponent,
})

function CardDetailRouteComponent() {
  const navigate = useNavigate()
  const { number } = Route.useParams()
  const { activeAccount } = useActiveAccount()
  const accountId = activeAccount?._id
  const cardNumber = Number(number)

  const card = useQuery(
    api.cards.getByNumber,
    accountId && Number.isFinite(cardNumber)
      ? { accountId, number: cardNumber }
      : 'skip',
  )
  const columns = useQuery(
    api.columns.listByBoard,
    accountId && card ? { accountId, boardId: card.boardId } : 'skip',
  )
  const updateCard = useMutation(api.cards.update)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!card) return
    setTitle(card.title)
    setDescription(card.description ?? '')
  }, [card])

  const editorAccent = useMemo(() => {
    if (!card) return '#c4492b'
    if (card.columnId === null) return '#8a5d2f'
    const column = columns?.find((candidate) => candidate._id === card.columnId)
    return column?.color ?? '#c4492b'
  }, [card, columns])

  async function onSave(): Promise<boolean> {
    if (!accountId || !card) return false

    setIsSaving(true)
    setError(null)
    try {
      await updateCard({
        accountId,
        cardId: card._id,
        title,
        description,
      })
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save card')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function onSaveAndBack() {
    const didSave = await onSave()
    if (!didSave) return
    await navigate({ to: '/boards' })
  }

  if (!activeAccount) {
    return (
      <section className="simple-page card-page">
        <header className="page-header">
          <h1>Card</h1>
          <p>No active account.</p>
        </header>
      </section>
    )
  }

  if (!Number.isFinite(cardNumber)) {
    return (
      <section className="simple-page card-page">
        <header className="page-header">
          <h1>Card</h1>
          <p>Invalid card number.</p>
        </header>
      </section>
    )
  }

  if (card === undefined) {
    return (
      <section className="simple-page card-page">
        <header className="page-header">
          <h1>Card #{number}</h1>
          <p>Loading card…</p>
        </header>
      </section>
    )
  }

  if (card === null) {
    return (
      <section className="simple-page card-page">
        <header className="page-header">
          <h1>Card #{number}</h1>
          <p>Card not found.</p>
        </header>
        <Link to="/boards" className="text-action">
          Back to board
        </Link>
      </section>
    )
  }

  return (
    <section
      className="simple-page card-page"
      style={{ '--card-column-accent': editorAccent } as CSSProperties}
    >
      <header className="page-header">
        <p className="page-eyebrow">Card</p>
        <h1>#{card.number}</h1>
      </header>

      <div
        className="card-editor card-editor-page"
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (isSaving) return
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            void onSaveAndBack()
          }
        }}
      >
        <label htmlFor="card-title">Title</label>
        <input
          id="card-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Card title"
          disabled={isSaving}
        />

        <label htmlFor="card-description">Description</label>
        <textarea
          id="card-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={12}
          placeholder="Add context, notes, and next actions"
          disabled={isSaving}
        />

        {error ? <p className="field-error">{error}</p> : null}

        <div className="card-editor-actions">
          <button
            type="button"
            className="text-action"
            onClick={() => void onSave()}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <Link to="/boards" className="text-action secondary-inline-action">
            Back to board
          </Link>
        </div>
      </div>
    </section>
  )
}
