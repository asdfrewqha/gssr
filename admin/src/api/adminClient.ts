import axios from 'axios'

const adminClient = axios.create({
  baseURL: import.meta.env.VITE_ADMIN_API_URL || 'http://localhost:8000',
  withCredentials: true,
})

export default adminClient
