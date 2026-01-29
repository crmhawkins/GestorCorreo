/**
 * SearchBar component - Advanced search with filters
 */
import { useState } from 'react'
import './SearchBar.css'

interface SearchFilters {
    search?: string
    from_email?: string
    date_from?: string
    date_to?: string
    has_attachments?: boolean
    is_starred?: boolean
    search_all?: boolean
}

interface SearchBarProps {
    onSearch: (filters: SearchFilters) => void
    onClear: () => void
}

export default function SearchBar({ onSearch, onClear }: SearchBarProps) {
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [search, setSearch] = useState('')
    const [fromEmail, setFromEmail] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [hasAttachments, setHasAttachments] = useState(false)
    const [isStarred, setIsStarred] = useState(false)
    const [searchAll, setSearchAll] = useState(false)

    const handleSearch = () => {
        const filters: SearchFilters = {}

        if (search) filters.search = search
        if (fromEmail) filters.from_email = fromEmail
        if (dateFrom) filters.date_from = dateFrom
        if (dateTo) filters.date_to = dateTo
        if (hasAttachments) filters.has_attachments = true
        if (isStarred) filters.is_starred = true
        if (searchAll) filters.search_all = true

        onSearch(filters)
    }

    const handleClear = () => {
        setSearch('')
        setFromEmail('')
        setDateFrom('')
        setDateTo('')
        setHasAttachments(false)
        setIsStarred(false)
        setSearchAll(false)
        onClear()
    }

    return (
        <div className="search-bar">
            <div className="search-main">
                <input
                    type="text"
                    className="search-input"
                    placeholder="🔍 Search messages..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <label className="search-all-check" title="Search in all folders">
                    <input
                        type="checkbox"
                        checked={searchAll}
                        onChange={(e) => setSearchAll(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.8rem', marginLeft: '4px' }}>All</span>
                </label>
                <button
                    className="btn-advanced"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    title="Advanced filters"
                >
                    {showAdvanced ? '▲' : '▼'}
                </button>
            </div>

            {showAdvanced && (
                <div className="search-advanced">
                    <div className="search-row">
                        <input
                            type="text"
                            placeholder="From email..."
                            value={fromEmail}
                            onChange={(e) => setFromEmail(e.target.value)}
                        />
                        <input
                            type="date"
                            placeholder="From date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                        />
                        <input
                            type="date"
                            placeholder="To date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                        />
                    </div>
                    <div className="search-row">
                        <label className="search-checkbox">
                            <input
                                type="checkbox"
                                checked={hasAttachments}
                                onChange={(e) => setHasAttachments(e.target.checked)}
                            />
                            <span>📎 Has Attachments</span>
                        </label>
                        <label className="search-checkbox">
                            <input
                                type="checkbox"
                                checked={isStarred}
                                onChange={(e) => setIsStarred(e.target.checked)}
                            />
                            <span>⭐ Starred Only</span>
                        </label>
                    </div>
                    <div className="search-actions">
                        <button className="btn-secondary" onClick={handleClear}>
                            Clear
                        </button>
                        <button className="btn-primary" onClick={handleSearch}>
                            Search
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
