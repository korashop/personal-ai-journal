import { ChevronLeft, ChevronRight, FileText, ImagePlus, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'

import { transcribePhotos } from '../lib/api'
import type { EntrySource, PhotoTranscriptionPayload } from '../types'

const MAX_PHOTO_UPLOADS = 24

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

type MissingOcrPage = {
  pageNumber: number
  fileName?: string
}

type TranscribedPage = PhotoTranscriptionPayload['pageResults'][number]

function buildTranscriptFromPages(pages: TranscribedPage[]) {
  return pages
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => `Page ${page.pageNumber}\n${page.text}`)
    .join('\n\n---\n\n')
}

function detectMissingOcrPages(pages: TranscribedPage[]): MissingOcrPage[] {
  return pages
    .filter((page) => !page.success)
    .map((page) => ({
      pageNumber: page.pageNumber,
      fileName: page.fileName,
    }))
    .sort((left, right) => left.pageNumber - right.pageNumber)
}

function formatDetectedDate(dateString?: string) {
  if (!dateString) return null
  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type EntryComposerProps = {
  busy: boolean
  submitPhase: 'idle' | 'submitting' | 'submitting_split'
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

function getCaptureStatusText(params: {
  busy: boolean
  submitPhase: EntryComposerProps['submitPhase']
  reviewBusy: boolean
  reviewReady: boolean
  hasTranscriptionAttempt: boolean
  failedCount: number
  photoCount: number
  splitCount: number
}) {
  const { busy, submitPhase, reviewBusy, reviewReady, hasTranscriptionAttempt, failedCount, photoCount, splitCount } = params

  if (reviewBusy) {
    return `Transcribing ${photoCount} page${photoCount === 1 ? '' : 's'} now...`
  }

  if (busy && submitPhase === 'submitting_split') {
    return `Analyzing and saving ${splitCount} entries now...`
  }

  if (busy && submitPhase === 'submitting') {
    return photoCount ? 'Transcription is done. Analysis and entry creation are in progress...' : 'Analysis and entry creation are in progress...'
  }

  if (reviewReady) {
    return 'Transcription is ready. Review the text, then submit when it looks right.'
  }

  if (hasTranscriptionAttempt && failedCount > 0) {
    return `${failedCount} page${failedCount === 1 ? '' : 's'} still need OCR help before full review can open.`
  }

  if (photoCount) {
    return 'Add pages in reading order, then transcribe before submitting.'
  }

  return `HEIC, JPG, and PNG are supported. Up to ${MAX_PHOTO_UPLOADS} pages per upload.`
}

export function EntryComposer({ busy, submitPhase, onSubmit }: EntryComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const [rawText, setRawText] = useState('')
  const [source, setSource] = useState<EntrySource>('typed')
  const [photos, setPhotos] = useState<File[]>([])
  const [transcribedPages, setTranscribedPages] = useState<TranscribedPage[]>([])
  const [transcribedText, setTranscribedText] = useState('')
  const [reviewReady, setReviewReady] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewMeta, setReviewMeta] = useState<{ imageCount: number; failedCount: number } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitAsSplitEntries, setSubmitAsSplitEntries] = useState(false)
  const [replaceTargetPage, setReplaceTargetPage] = useState<number | null>(null)
  const [pageRetryBusy, setPageRetryBusy] = useState<number | null>(null)

  const splitCandidates = useMemo(
    () => (reviewReady && !rawText.trim() ? detectSplitCandidates(transcribedText) : []),
    [rawText, reviewReady, transcribedText],
  )
  const missingOcrPages = useMemo(
    () => detectMissingOcrPages(transcribedPages),
    [transcribedPages],
  )
  const hasTranscriptionAttempt = reviewMeta !== null
  const captureStatusText = getCaptureStatusText({
    busy,
    submitPhase,
    reviewBusy,
    reviewReady,
    hasTranscriptionAttempt,
    failedCount: reviewMeta?.failedCount ?? 0,
    photoCount: photos.length,
    splitCount: splitCandidates.length,
  })

  function resetReviewState(nextError: string | null = null) {
    setTranscribedPages([])
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(nextError)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
    setPageRetryBusy(null)
  }

  function appendPhotos(nextFiles: File[]) {
    let nextError: string | null = null

    setPhotos((current) => {
      const seen = new Set(current.map((photo) => `${photo.name}-${photo.lastModified}-${photo.size}`))
      const merged = [...current]
      let skippedForLimit = 0

      for (const file of nextFiles) {
        const key = `${file.name}-${file.lastModified}-${file.size}`
        if (!seen.has(key)) {
          if (merged.length >= MAX_PHOTO_UPLOADS) {
            skippedForLimit += 1
            continue
          }
          seen.add(key)
          merged.push(file)
        }
      }

      if (skippedForLimit > 0) {
        nextError = `You can upload up to ${MAX_PHOTO_UPLOADS} pages at once. ${skippedForLimit} page${skippedForLimit === 1 ? '' : 's'} were not added.`
      }

      return merged
    })
    resetReviewState(nextError)
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    resetReviewState()
  }

  function removePhoto(target: File) {
    setPhotos((current) =>
      current.filter((item) => `${item.name}-${item.lastModified}` !== `${target.name}-${target.lastModified}`),
    )
    resetReviewState()
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
    setTranscribedPages([])
    setTranscribedText('')
    setReviewReady(false)
    setReviewError(null)
    setReviewMeta(null)
    setSubmitAsSplitEntries(false)
    setPageRetryBusy(null)
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

  async function runPhotoTranscription(nextPhotos: File[]) {
    if (!nextPhotos.length) return
    try {
      setReviewBusy(true)
      setReviewError(null)
      const result = await transcribePhotos(nextPhotos)
      setTranscribedPages(result.pageResults)
      setTranscribedText(result.failedCount === 0 ? buildTranscriptFromPages(result.pageResults) : '')
      setReviewMeta({ imageCount: result.imageCount, failedCount: result.failedCount })
      setReviewReady(result.failedCount === 0 && result.pageResults.length === nextPhotos.length)
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

  async function handleReviewTranscription() {
    await runPhotoTranscription(photos)
  }

  function handleReplacePage(pageNumber: number) {
    setReplaceTargetPage(pageNumber)
    replaceInputRef.current?.click()
  }

  async function handleReplaceInputChange(event: ChangeEvent<HTMLInputElement>) {
    const replacement = event.target.files?.[0]
    const pageNumber = replaceTargetPage
    event.target.value = ''

    if (!replacement || !pageNumber) return

    const nextPhotos = photos.map((photo, index) => (index === pageNumber - 1 ? replacement : photo))
    setPhotos(nextPhotos)
    setSource('photo')
    setReplaceTargetPage(null)
    await retryPageTranscription(pageNumber, replacement, nextPhotos)
  }

  async function retryPageTranscription(pageNumber: number, file: File, nextPhotos = photos) {
    try {
      setPageRetryBusy(pageNumber)
      setReviewError(null)
      const result = await transcribePhotos([file])
      const pageResult = result.pageResults[0] ?? {
        pageNumber,
        fileName: file.name,
        text: '[OCR unavailable for this image]',
        success: false,
      }

      const mergedPages = [...transcribedPages]
      const normalizedPage = {
        ...pageResult,
        pageNumber,
        fileName: file.name,
      }
      const existingIndex = mergedPages.findIndex((page) => page.pageNumber === pageNumber)
      if (existingIndex >= 0) {
        mergedPages[existingIndex] = normalizedPage
      } else {
        mergedPages.push(normalizedPage)
      }
      mergedPages.sort((left, right) => left.pageNumber - right.pageNumber)

      const failedCount = mergedPages.filter((page) => !page.success).length
      setTranscribedPages(mergedPages)
      setReviewMeta({ imageCount: nextPhotos.length, failedCount })
      setReviewReady(failedCount === 0 && mergedPages.length === nextPhotos.length)
      setTranscribedText(failedCount === 0 ? buildTranscriptFromPages(mergedPages) : '')
      setSubmitAsSplitEntries(false)
      setReviewError(
        normalizedPage.success
          ? null
          : `Page ${pageNumber} still could not be read. Try replacing that image or a clearer export of the same page.`,
      )
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : `Could not retry page ${pageNumber}.`)
    } finally {
      setPageRetryBusy(null)
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
                Drag images here or use the picker. HEIC, JPG, and PNG are supported, up to {MAX_PHOTO_UPLOADS} pages at a time.
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
            accept="image/*,.heic,.heif"
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
          <input
            accept="image/*,.heic,.heif"
            hidden
            onChange={(event) => {
              void handleReplaceInputChange(event)
            }}
            ref={replaceInputRef}
            type="file"
          />
          <div className="capture-steps">
            <span className={`capture-step ${photos.length ? 'done' : ''}`}>1. Add pages</span>
            <span className={`capture-step ${hasTranscriptionAttempt && reviewMeta?.failedCount === 0 ? 'done' : photos.length ? 'active' : ''}`}>2. Read pages</span>
            <span className={`capture-step ${hasTranscriptionAttempt && (reviewMeta?.failedCount ?? 0) > 0 ? 'active' : reviewReady ? 'done' : ''}`}>3. Fix unreadable pages</span>
            <span className={`capture-step ${busy ? 'active' : reviewReady ? 'active' : ''}`}>4. Review and save</span>
          </div>
          <p className={`hint capture-status ${reviewBusy || busy ? 'active' : ''}`}>{captureStatusText}</p>
          {photos.length ? (
            <div className="photo-review-actions photo-review-actions-top">
              <button className="ghost-button" disabled={reviewBusy || busy} onClick={() => void handleReviewTranscription()} type="button">
                {reviewBusy ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}
                {reviewBusy ? 'Reading pages...' : hasTranscriptionAttempt ? 'Read pages again' : 'Read pages'}
              </button>
              {reviewMeta ? (
                <span className="hint">
                  {reviewMeta.failedCount
                    ? `${reviewMeta.imageCount - reviewMeta.failedCount}/${reviewMeta.imageCount} pages readable`
                    : `All ${reviewMeta.imageCount}/${reviewMeta.imageCount} pages are readable`}
                </span>
              ) : (
                <span className="hint">Run OCR once, then fix only the pages that still need help.</span>
              )}
            </div>
          ) : null}
          {hasTranscriptionAttempt && !reviewReady && reviewMeta ? (
            <div className="ocr-resolution-panel">
              <div className="ocr-resolution-header">
                <div>
                  <p className="subtle-label">Resolve unreadable pages</p>
                  <h3>{reviewMeta.failedCount ? `${reviewMeta.failedCount} page${reviewMeta.failedCount === 1 ? '' : 's'} still need help` : 'All pages are readable'}</h3>
                  <p className="hint ocr-resolution-hint">
                    We’ll keep the pages that already worked. Retry or replace only the broken ones, then the full transcription review will open.
                  </p>
                </div>
              </div>
              {missingOcrPages.length ? (
                <div className="ocr-missing-list">
                  {missingOcrPages.map((item) => (
                    <div className="ocr-missing-row" key={`${item.pageNumber}-${item.fileName ?? 'page'}`}>
                      <div className="ocr-missing-row-main">
                        <span className="ocr-missing-chip">
                          Page {item.pageNumber}{item.fileName ? ` - ${item.fileName}` : ''}
                        </span>
                        <span className="hint">This page still needs OCR help before review can open.</span>
                      </div>
                      <div className="ocr-missing-row-actions">
                        <button
                          className="ghost-button compact-button"
                          disabled={busy || reviewBusy || pageRetryBusy === item.pageNumber}
                          onClick={() => {
                            const pageFile = photos[item.pageNumber - 1]
                            if (!pageFile) return
                            void retryPageTranscription(item.pageNumber, pageFile)
                          }}
                          type="button"
                        >
                          {pageRetryBusy === item.pageNumber ? <LoaderCircle className="spin" size={16} /> : null}
                          Retry OCR
                        </button>
                        <button
                          className="ghost-button compact-button"
                          disabled={busy || reviewBusy || pageRetryBusy === item.pageNumber}
                          onClick={() => handleReplacePage(item.pageNumber)}
                          type="button"
                        >
                          Replace image
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {reviewReady ? (
            <div className="transcription-review transcription-review-prominent">
              <div className="transcription-review-header">
                <div>
                  <p className="subtle-label">Transcription review</p>
                  <p className="hint transcription-review-hint">
                    This is the main review step before submission. Add a date heading on its own line when a new journal day should become a separate entry.
                  </p>
                </div>
                <span className="hint">
                  Review, edit, then submit
                </span>
              </div>
              <textarea
                className="entry-textarea transcription-textarea transcription-textarea-prominent"
                onChange={(event) => setTranscribedText(event.target.value)}
                rows={18}
                value={transcribedText}
              />

              {splitCandidates.length ? (
                <div className="split-review">
                  <div className="split-review-header">
                    <div>
                      <p className="subtle-label">Possible entry splits</p>
                      <p className="hint">
                        I found {splitCandidates.length} dated sections in this reviewed text. If you split them, each entry will use its detected date and appear in chronological order in the journal.
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
                        <p className="split-preview-date">
                          {formatDetectedDate(candidate.createdAt)
                            ? `Will be dated ${formatDetectedDate(candidate.createdAt)} in the journal`
                            : 'No date was confidently detected yet'}
                        </p>
                        <p>{candidate.preview}</p>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="transcription-review-submit">
                <button
                  className="primary-button"
                  disabled={busy || !reviewReady}
                  type="submit"
                >
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                  {busy
                    ? submitPhase === 'submitting_split'
                      ? `Saving ${splitCandidates.length} entries...`
                      : 'Analyzing and saving...'
                    : submitAsSplitEntries && splitCandidates.length
                      ? `Submit ${splitCandidates.length} entries`
                      : 'Submit reviewed entry'}
                </button>
              </div>
            </div>
          ) : null}
          {photos.length ? (
            <div className="photo-page-list">
              {photos.map((photo, index) => (
                <div className="photo-page-card" key={`${photo.name}-${photo.lastModified}`}>
                  <div className="photo-page-meta">
                    <span className="photo-page-number">Page {index + 1}</span>
                    <strong>{photo.name}</strong>
                  </div>
                  <div className="photo-page-actions">
                    <button className="ghost-button compact-icon" disabled={busy || reviewBusy || index === 0} onClick={() => movePhoto(index, -1)} type="button">
                      <ChevronLeft size={16} />
                    </button>
                    <button className="ghost-button compact-icon" disabled={busy || reviewBusy || index === photos.length - 1} onClick={() => movePhoto(index, 1)} type="button">
                      <ChevronRight size={16} />
                    </button>
                    <button className="ghost-button compact-icon danger-button" disabled={busy || reviewBusy} onClick={() => removePhoto(photo)} type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {reviewError ? <p className="review-error">{reviewError}</p> : null}
        </div>

        {photos.length === 0 ? (
          <button
            className="primary-button"
            disabled={busy || !rawText.trim()}
            type="submit"
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
            {busy ? 'Analyzing and saving...' : 'Submit entry'}
          </button>
        ) : null}
      </div>
    </form>
  )
}
