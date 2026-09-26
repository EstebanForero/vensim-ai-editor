#!/usr/bin/env fish

# DeepSeek API key
set -x ANTHROPIC_AUTH_TOKEN "sk-4d1c9f9a628e48d799cad66397b29612"

# DeepSeek Anthropic-compatible endpoint
set -x ANTHROPIC_BASE_URL "https://api.deepseek.com/anthropic"

# Models
set -x ANTHROPIC_MODEL "deepseek-flash[1m]"
set -x ANTHROPIC_DEFAULT_OPUS_MODEL "deepseek-flash[1m]"
set -x ANTHROPIC_DEFAULT_SONNET_MODEL "deepseek-flash[1m]"
set -x ANTHROPIC_DEFAULT_HAIKU_MODEL "deepseek-flash"

set -x CLAUDE_CODE_SUBAGENT_MODEL "deepseek-flash"
set -x CLAUDE_CODE_EFFORT_LEVEL "max"
set -x CLAUDE_CODE_AUTO_COMPACT_WINDOW "786432"

# Start Claude Code with DeepSeek
exec claude $argv
