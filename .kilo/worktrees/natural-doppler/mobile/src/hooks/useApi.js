// ============================================================================
// FILE: mobile/src/hooks/useApi.js
// PURPOSE: Custom hook for API calls with loading/error state
// ============================================================================

/**
 * Ye hook API calls ke liye reusable hook provide karta hai.
 * Loading, error, data state automatically manage karta hai.
 * 
 * Usage:
 * const { data, loading, error, execute } = useApi(api.get, '/api/endpoint');
 * 
 * Data Flow:
 * Component → useApi → API Service → Backend
 * Response → Hook State → Component Re-render
 */

import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

/**
 * Generic API Hook
 * @param {Function} apiFn - API function to call
 * @param {Array} deps - Dependencies for auto-execution
 * @returns {Object} { data, loading, error, execute, refetch }
 */
export const useApi = (apiFn, deps = []) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFn(...args);
      setData(result);
      return result;
    } catch (err) {
      setError(err.message || 'An error occurred');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiFn]);

  // Auto-execute on mount and dependency changes
  useEffect(() => {
    if (deps.length === 0 || deps.some(d => d !== undefined)) {
      execute();
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => execute(), [execute]);

  return { data, loading, error, execute, refetch };
};

/**
 * Paginated API Hook
 * @param {Function} apiFn - API function
 * @param {Object} initialParams - Initial query params
 * @returns {Object} { data, loading, error, execute, loadMore, hasMore }
 */
export const usePaginatedApi = (apiFn, initialParams = {}) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [params, setParams] = useState(initialParams);

  const execute = useCallback(async (isRefresh = false) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const currentPage = isRefresh ? 1 : page;
      const queryParams = { ...params, page: currentPage };
      const result = await apiFn(queryParams);
      
      const newData = result.rows || result.data || [];
      const total = result.total || newData.length;
      
      if (isRefresh) {
        setData(newData);
      } else {
        setData(prev => [...prev, ...newData]);
      }
      
      setHasMore(newData.length > 0 && data.length + newData.length < total);
      if (!isRefresh) setPage(prev => prev + 1);
      
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiFn, params, page, data.length]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) execute(false);
  }, [loading, hasMore, execute]);

  const refresh = useCallback(() => {
    setPage(1);
    execute(true);
  }, [execute]);

  return { data, loading, error, execute, loadMore, hasMore, refresh, setParams };
};

export default useApi;