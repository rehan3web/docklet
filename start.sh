#!/bin/bash
# Start backend in background
cd /home/runner/workspace/Backend && npm install --silent && npx ts-node src/index.ts &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend on port 3001..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "Backend ready on port 3001"
    break
  fi
  sleep 1
done

# Start frontend in foreground
cd /home/runner/workspace/Frontend && npm install --silent && npm run dev
