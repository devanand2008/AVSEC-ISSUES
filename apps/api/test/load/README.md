# AVS College Management System — Load Testing Configuration

This directory contains `k6` load testing scripts to evaluate concurrent multi-user capacity, authentication throughput, messaging delays, and broadcast delivery performance.

## Running the Load Test

If `k6` is installed on your machine:
```bash
k6 run k6-load-test.js
```

Or run via Docker:
```bash
docker run --rm -i grafana/k6 run - <k6-load-test.js
```

### Environment Variables
- `API_URL`: Target base URL for the API server (default: `http://localhost:4000`).
```bash
API_URL=https://staging-api.avs.edu.in k6 run k6-load-test.js
```
