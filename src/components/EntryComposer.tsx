import { ChevronLeft, ChevronRight, FileText, ImagePlus, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'

import { transcribePhotos } from '../lib/api'
import type { EntrySource } from '../types'

type SplitCandidate = {
  id: string
  label: string
  createdAt?: string
  rawText: string
  preview: string
}

const DATE_HEADING_PATTERNS = [
  /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?$/i,
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?$/i,
  /^(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}[/-]\d{1,2}[/-]\d{1,2})$/,
]

function cleanSplitText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function clipSplitPreview(text: string, maxLength = 150) {
  const cleaned = cleanSplitText(text)
  if (cleaned.length <= maxLength) return cleaned
  const clipped = cleaned.slice(0, maxLength)
  const boundary = clipped.lastIndexOf(' ')
  return `${(boundary > 70 ? clipped.slice(0, boundary) : clipped).trim()}...`
}

function detectDateHeading(line: string) {
  const cleaned = line.trim().replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ')
  if (!cleaned) return null
  if (!DATE_HEADING_PATTERNS.some((pattern) => pattern.test(cleaned))) return null

  const normalized = cleaned
    .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+/i, '')
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, '$1')

  const numericMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/)
  if (numericMatch) {
    const [, month, day, yearValue] = numericMatch
    const year = yearValue ? Number(yearValue.length === 2 ? `20${yearValue}` : yearValue) : new Date().getFullYear()
    const parsed = new Date(Date.UTC(year, Number(month) - 1, Number(day)))
    if (Number.isNaN(parsed.getTime())) {
      return { label: cleaned }
    }
    return {
      label: cleaned,
      createdAt: parsed.toISOString(),
    }
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return { label: cleaned }
  }

  return {
    label: cleaned,
    createdAt: new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())).toISOString(),
  }
}

function detectSplitCandidates(text: string): SplitCandidate[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))

  const boundaries = lines
    .map((line, index) => ({ index, heading: detectDateHeading(line) }))
    .filter((item) => item.heading)

  if (boundaries.length < 2) return []

  return boundaries
    .map((item, index) => {
      const start = item.index
      const end = boundaries[index + 1]?.index ?? lines.length
      const sectionLines = lines.slice(start, end).join('\n').trim()
      const bodyPreview = lines.slice(start + 1, end).join(' ').trim()
      return {
        id: `${index}-${item.heading?.label ?? 'entry'}`,
        label: item.heading?.label ?? `Entry ${index + 1}`,
        createdAt: item.heading?.createdAt,
        rawText: sectionLines,
        preview: clipSplitPreview(bodyPreview || sectionLines),
      }
    })
    .filter((candidate) => cleanSplitText(candidate.rawText))
}

type EntryComposerProps = {
  busy: boolean
  onSubmit: (payload: {
    rawText: string
    source: EntrySource
    photos: File[]
    transcribedText?: string
    splitEntries?: Array<{
      rawText: string
      createdAt?: string
    }>
  }) => Promise<void>
}

export function EntryComposer({ busy, onSubmit }: EntryComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [rawText, setRawText] = useState('')
  const [source, setSource] = useState<EntrySource>('typed')
  const [photos, setPhotos] = useState<File[]>([])
  const [transcribedText, setTranscribedText] = useState('')
  const [reviewReady, setReviewReady] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewMeta, setReviewMeta] = useState<{ imageCount: number; failedCount: number } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitAsSplitEntries, setSubmitAsSplitEntries] = useState(false)

  const splitCandidates = useMemo(
    () => (reviewReady && !rawText.trim() ? detectSplitCandidates(transcribedText) : []),
    [rawText, reviewReady, transcribedText],
  )

  function appendPhotos(nextFiles: File[]) {
    setPhotos((current) => {
      const seen = new Set(current.map((photo) => `${photo.name}-${photo.lastModified}-${photo.size}`))
      const merged = [...current]

      for (const file of nextFiles) {
        const key = `${file.name}-${file.lastModified}-${file.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(file)
        }
      }

      return merged
    })
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
  }

  function removePhoto(target: File) {
    setPhotos((current) =>
      current.filter((item) => `${item.name}-${item.lastModified}` !== `${target.name}-${target.lastModified}`),
    )
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rawText.trim() && photos.length === 0) {
      return
    }

    await onSubmit({
      rawText: rawText.trim(),
      source,
      photos,
      transcribedText: reviewReady ? transcribedText.trim() : undefined,
      splitEntries: submitAsSplitEntries && splitCandidates.length
        ? splitCandidates.map((candidate) => ({
            rawText: candidate.rawText,
            createdAt: candidate.createdAt,
          }))
        : undefined,
    })

    setRawText('')
    setSource('typed')
    setPhotos([])
    setTranscribedText('')
    setReviewReady(false)
    setReviewError(null)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const nextPhotos = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!nextPhotos.length) return
    appendPhotos(nextPhotos)
    setSource('photo')
  }

  async function handleReviewTranscription() {
    if (!photos.length) return

    try {
      setReviewBusy(true)
      setReviewError(null)
      const result = await transcribePhotos(photos)
      setTranscribedText(result.transcript)
      setReviewMeta({ imageCount: result.imageCount, failedCount: result.failedCount })
      setReviewReady(result.anySucceeded)
      setSubmitAsSplitEntries(false)

      if (!result.anySucceeded) {
        setReviewError('The app could not read those images well enough yet. Try adding a bit of typed context, or use clearer JPG/PNG photos.')
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not transcribe the photos.')
      setReviewReady(false)
    } finally {
      setReviewBusy(false)
    }
  }

  return (
    <form className="panel composer" onSubmit={handleSubmit}>
      <div className="section-header">
        <div>
          <p className="eyebrow">Capture</p>
          <h2>New entry</h2>
        </div>
        <div className="composer-actions">
          <label className={`source-chip ${source === 'typed' ? 'active' : ''}`}>
            <input
              checked={source === 'typed'}
              name="source"
              onChange={() => setSource('typed')}
              type="radio"
            />
            Type
          </label>
          <label className={`source-chip ${source === 'paste' ? 'active' : ''}`}>
            <input
              checked={source === 'paste'}
              name="source"
              onChange={() => setSource('paste')}
              type="radio"
            />
            Paste
          </label>
          <label className={`source-chip ${source === 'photo' ? 'active' : ''}`}>
            <input
              checked={source === 'photo'}
              name="source"
              onChange={() => setSource('photo')}
              type="radio"
            />
            Photo
          </label>
        </div>
      </div>

      <textarea
        className="entry-textarea"
        onChange={(event) => setRawText(event.target.value)}
        placeholder="What happened? What are you rationalizing? What keeps repeating?"
        rows={10}
        value={rawText}
      />

      <div className="composer-footer">
        <div
          className={`photo-upload ${photos.length ? 'has-photos' : ''} ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget === event.target) {
              setDragActive(false)
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDrop={handleDrop}
        >
          <div className="photo-upload-header">
            <div>
              <p className="subtle-label">Journal pages</p>
              <h3>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} attached` : 'Add journal photos'}</h3>
              <p className="hint upload-sequence-hint">
                Upload in reading order. The app transcribes in the order shown below.
              </p>
              <p className="hint upload-drop-hint">
                Drag images here or use the picker. HEIC, JPG, and PNG are supported.
              </p>
            </div>
            <button
              className="ghost-button"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <ImagePlus size={16} />
              {photos.length ? 'Add more' : 'Choose files'}
            </button>
          </div>
          <input
            accept="image/*"
            hidden
            multiple
            onChange={(event) => {
              const nextPhotos = Array.from(event.target.files ?? [])
              appendPhotos(nextPhotos)
              if (nextPhotos.length) {
                setSource('photo')
              }
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
              }
            }}
            ref={fileInputRef}
            type="file"
          />
          <div className="capture-steps">
            <span className={`capture-step ${photos.length ? 'done' : ''}`}>1. Add pages</span>
            <span className={`capture-step ${reviewReady ? 'done' : photos.length ? 'active' : ''}`}>2. Transcribe images</span>
            <span className={`capture-step ${reviewReady ? 'active' : ''}`}>3. Submit entry</span>
          </div>
          {photos.length ? (
            <div className="photo-page-list">
              {photos.map((photo, index) => (
                <div className="photo-page-card" key={`${photo.name}-${photo.lastModified}`}>
                  <div className="photo-page-meta">
                    <span className="photo-page-number">Page {index + 1}</span>
                    <strong>{photo.name}</strong>
                  </div>
                  <div className="photo-page-actions">
                    <button className="ghost-button compact-icon" disabled={index === 0} onClick={() => movePhoto(index, -1)} type="button">
                      <ChevronLeft size={16} />
                    </button>
                    <button className="ghost-button compact-icon" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)} type="button">
                      <ChevronRight size={16} />
                    </button>
                    <button className="ghost-button compact-icon danger-button" onClick={() => removePhoto(photo)} type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {photos.length ? (
            <div className="photo-review-actions">
              <button className="ghost-button" disabled={reviewBusy} onClick={() => void handleReviewTranscription()} type="button">
                {reviewBusy ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}
                {reviewBusy ? 'Reading photos...' : reviewReady ? 'Re-transcribe images' : 'Transcribe images'}
              </button>
              {reviewMeta ? (
                <span className="hint">
                  {reviewMeta.failedCount
                    ? `${reviewMeta.imageCount - reviewMeta.failedCount}/${reviewMeta.imageCount} images read`
                    : `Read ${reviewMeta.imageCount}/${reviewMeta.imageCount} images`}
                </span>
              ) : (
                <span className="hint">Click transcribe images before submitting.</span>
              )}
            </div>
          ) : null}

          {reviewError ? <p className="review-error">{reviewError}</p> : null}

          {reviewReady ? (
            <div className="transcription-review">
              <div className="transcription-review-header">
                <p className="subtle-label">Transcription review</p>
                <span className="hint">Edit here, then submit</span>
              </div>
              <textarea
                className="entry-textarea transcription-textarea"
                onChange={(event) => setTranscribedText(event.target.value)}
                rows={12}
                value={transcribedText}
              />

              {splitCandidates.length ? (
                <div className="split-review">
                  <div className="split-review-header">
                    <div>
                      <p className="subtle-label">Possible entry splits</p>
                      <p className="hint">
                        I found {splitCandidates.length} dated sections in this reviewed text. You can keep one combined entry or submit them separately.
                      </p>
                    </div>
                    <div className="split-review-actions">
                      <button
                        className={`ghost-button ${!submitAsSplitEntries ? 'selected' : ''}`}
                        onClick={() => setSubmitAsSplitEntries(false)}
                        type="button"
                      >
                        Keep one entry
                      </button>
                      <button
                        className={`ghost-button ${submitAsSplitEntries ? 'selected' : ''}`}
                        onClick={() => setSubmitAsSplitEntries(true)}
                        type="button"
                      >
                        Submit as {splitCandidates.length} entries
                      </button>
                    </div>
                  </div>

                  <div className="split-preview-list">
                    {splitCandidates.map((candidate, index) => (
                      <section className="split-preview-card" key={candidate.id}>
                        <div className="split-preview-header">
                          <strong>{candidate.label}</strong>
                          <span className="hint">Entry {index + 1}</span>
                        </div>
                        <p>{candidate.preview}</p>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          className="primary-button"
          disabled={busy || (!rawText.trim() && photos.length === 0) || (photos.length > 0 && !reviewReady)}
          type="submit"
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
          {busy ? 'Thinking...' : submitAsSplitEntries && splitCandidates.length ? `Submit ${splitCandidates.length} entries` : photos.length ? 'Submit reviewed entry' : 'Submit entry'}
        </button>
      </div>
    </form>
  )
}
