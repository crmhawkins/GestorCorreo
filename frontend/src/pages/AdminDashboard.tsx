import React, { useState, useEffect } from 'react';
import { getUsers, createUser, deleteUser, restoreUser } from '../services/api';
import type { User } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const AdminDashboard: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [deletedUsers, setDeletedUsers] = useState<User[]>([]);

    // Helper to format bytes
    const formatBytes = (bytes?: number) => {
        if (bytes === undefined || bytes === null) return '0 B';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    const [view, setView] = useState<'active' | 'deleted'>('active');
    const [newUserValues, setNewUserValues] = useState({ username: '', password: '', is_admin: false });
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    useEffect(() => {
        if (user && !user.is_admin) {
            navigate('/');
        } else if (user?.is_admin) {
            loadUsers();
        }
    }, [user, navigate]);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const [activeData, deletedData] = await Promise.all([
                getUsers(false),
                getUsers(true)
            ]);
            setUsers(activeData);
            setDeletedUsers(deletedData);
        } catch (e) {
            console.error(e);
            setError("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        try {
            await createUser(newUserValues);
            setNewUserValues({ username: '', password: '', is_admin: false });
            setSuccessMsg("User created successfully");
            loadUsers();
        } catch (e) {
            console.error(e);
            setError("Failed to create user. Username might exist.");
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this user? They will be moved to deleted items.')) return;
        try {
            await deleteUser(id, false); // Soft delete
            setSuccessMsg('User moved to trash');
            loadUsers();
        } catch (e) {
            setError('Failed to delete user');
        }
    };

    const handleRestore = async (id: number) => {
        try {
            await restoreUser(id);
            setSuccessMsg('User restored');
            loadUsers();
        } catch (e) {
            setError('Failed to restore user');
        }
    };

    const handlePermanentDelete = async (id: number) => {
        if (!confirm('Are you sure? This cannot be undone.')) return;
        try {
            await deleteUser(id, true); // Hard delete
            setSuccessMsg('User permanently deleted');
            loadUsers();
        } catch (e: any) {
            setError(e.response?.data?.detail || 'Failed to permanently delete user');
        }
    };

    if (loading && users.length === 0 && deletedUsers.length === 0) return <div style={{ padding: '2rem' }}>Loading admin dashboard...</div>;

    return (
        <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', alignItems: 'center' }}>
                <h1>Admin Dashboard</h1>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={() => navigate('/')} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>Go to Mail</button>
                    <button onClick={logout} style={{ padding: '0.5rem 1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
                </div>
            </div>

            {error && <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '1rem', marginBottom: '1rem', borderRadius: '4px' }}>{error}</div>}
            {successMsg && <div style={{ backgroundColor: '#d4edda', color: '#155724', padding: '1rem', marginBottom: '1rem', borderRadius: '4px' }}>{successMsg}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '3rem' }}>
                <div style={{ backgroundColor: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', height: 'fit-content' }}>
                    <h3>Create New User</h3>
                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Username</label>
                            <input
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ced4da' }}
                                placeholder="Username"
                                value={newUserValues.username}
                                onChange={e => setNewUserValues({ ...newUserValues, username: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
                            <input
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ced4da' }}
                                placeholder="Password"
                                type="password"
                                value={newUserValues.password}
                                onChange={e => setNewUserValues({ ...newUserValues, password: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={newUserValues.is_admin}
                                    onChange={e => setNewUserValues({ ...newUserValues, is_admin: e.target.checked })}
                                />
                                Is Admin User
                            </label>
                        </div>
                        <button type="submit" style={{ padding: '0.75rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                            Create User
                        </button>
                    </form>
                </div>

                <div>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem' }}>
                        <button
                            onClick={() => setView('active')}
                            style={{
                                padding: '0.5rem 1rem',
                                border: 'none',
                                borderBottom: view === 'active' ? '2px solid #007bff' : 'none',
                                background: 'transparent',
                                fontWeight: view === 'active' ? 'bold' : 'normal',
                                cursor: 'pointer'
                            }}
                        >
                            Active Users ({users.length})
                        </button>
                        <button
                            onClick={() => setView('deleted')}
                            style={{
                                padding: '0.5rem 1rem',
                                border: 'none',
                                borderBottom: view === 'deleted' ? '2px solid #007bff' : 'none',
                                background: 'transparent',
                                fontWeight: view === 'deleted' ? 'bold' : 'normal',
                                cursor: 'pointer',
                                color: '#dc3545'
                            }}
                        >
                            Deleted Users ({deletedUsers.length})
                        </button>
                    </div>

                    <div style={{ border: '1px solid #dee2e6', borderRadius: '4px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#e9ecef', textAlign: 'left' }}>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>ID</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>Username</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>Role</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>Storage</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>Status</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #dee2e6' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {view === 'active' ? (
                                    users.map(u => (
                                        <tr key={u.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                                            <td style={{ padding: '0.75rem' }}>{u.id}</td>
                                            <td style={{ padding: '0.75rem' }}>{u.username}</td>
                                            <td style={{ padding: '0.75rem' }}>{u.is_admin ? <span style={{ backgroundColor: '#ffc107', padding: '0.2rem 0.4rem', borderRadius: '3px', fontSize: '0.8rem' }}>Admin</span> : 'User'}</td>
                                            <td style={{ padding: '0.75rem', color: '#666' }}>{formatBytes(u.mailbox_usage_bytes)}</td>
                                            <td style={{ padding: '0.75rem' }}><span style={{ color: 'green' }}>Active</span></td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {!u.is_admin || u.username !== 'admin' ? (
                                                    <button
                                                        onClick={() => handleDelete(u.id)}
                                                        style={{ padding: '4px 8px', background: '#fff', border: '1px solid #dc3545', color: '#dc3545', borderRadius: '4px', cursor: 'pointer' }}
                                                    >
                                                        🗑️ Delete
                                                    </button>
                                                ) : <span style={{ color: '#999', fontSize: '0.8rem' }}>Protected</span>}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    deletedUsers.map(u => (
                                        <tr key={u.id} style={{ borderBottom: '1px solid #dee2e6', backgroundColor: '#fff5f5' }}>
                                            <td style={{ padding: '0.75rem', color: '#888' }}>{u.id}</td>
                                            <td style={{ padding: '0.75rem', color: '#888' }}>{u.username}</td>
                                            <td style={{ padding: '0.75rem', color: '#888' }}>{u.is_admin ? 'Admin' : 'User'}</td>
                                            <td style={{ padding: '0.75rem', color: '#888' }}>{formatBytes(u.mailbox_usage_bytes)}</td>

                                            <td style={{ padding: '0.75rem' }}><span style={{ color: '#dc3545' }}>Deleted</span></td>
                                            <td style={{ padding: '0.75rem', display: 'flex', gap: '5px' }}>
                                                <button
                                                    onClick={() => handleRestore(u.id)}
                                                    style={{ padding: '4px 8px', background: '#fff', border: '1px solid #28a745', color: '#28a745', borderRadius: '4px', cursor: 'pointer' }}
                                                >
                                                    ♻️ Restore
                                                </button>
                                                <button
                                                    onClick={() => handlePermanentDelete(u.id)}
                                                    style={{ padding: '4px 8px', background: '#dc3545', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                                                >
                                                    🔥 Destroy
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                                {((view === 'active' && users.length === 0) || (view === 'deleted' && deletedUsers.length === 0)) && (
                                    <tr>
                                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                                            No {view} users found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default AdminDashboard;
