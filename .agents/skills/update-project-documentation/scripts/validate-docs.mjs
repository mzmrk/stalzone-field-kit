#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '..', '..', '..', '..')
const root = resolveRoot(process.argv.slice(2))
const docsDir = path.join(root, 'docs')
const errors = []

if (!fs.existsSync(docsDir)) fail(`Documentation directory does not exist: ${docsDir}`)

const docs = listFiles(docsDir, file => file.endsWith('.md')).sort()
const indexPath = path.join(docsDir, 'README.md')
if (!fs.existsSync(indexPath)) errors.push('Missing docs/README.md')

const indexedTargets = fs.existsSync(indexPath)
    ? collectRelativeLinkTargets(indexPath, fs.readFileSync(indexPath, 'utf8'))
    : new Set()

for (const documentPath of docs) {
    const text = fs.readFileSync(documentPath, 'utf8')
    validateRelativeLinks(documentPath, text)
    if (documentPath !== indexPath && !indexedTargets.has(path.resolve(documentPath))) {
        errors.push(`${relative(documentPath)} is not linked from docs/README.md`)
    }
}

validateDocumentationBoundaries()
validateAgentPolicyLocation()

const totalWords = docs.reduce((sum, documentPath) => {
    const text = fs.readFileSync(documentPath, 'utf8').trim()
    return sum + (text ? text.split(/\s+/u).length : 0)
}, 0)

if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`)
    process.exit(1)
}

console.log(`Validated ${docs.length} documentation files (${totalWords} words).`)
console.log('Index coverage, relative links, documentation boundaries, and AGENTS.md location are valid.')

function resolveRoot(args) {
    if (args.length === 0) return defaultRoot
    if (args.length === 2 && args[0] === '--root') return path.resolve(args[1])
    fail('Usage: validate-docs.mjs [--root path]')
}

function validateRelativeLinks(documentPath, text) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const rawTarget = match[1].trim()
        const target = rawTarget.split('#')[0]
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
        let decoded
        try {
            decoded = decodeURIComponent(target)
        } catch {
            errors.push(`${relative(documentPath)} contains an invalid encoded link: ${rawTarget}`)
            continue
        }
        const resolved = path.resolve(path.dirname(documentPath), decoded)
        if (!fs.existsSync(resolved)) errors.push(`${relative(documentPath)} contains a broken link: ${rawTarget}`)
    }
}

function collectRelativeLinkTargets(documentPath, text) {
    const targets = new Set()
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].trim().split('#')[0]
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
        try {
            targets.add(path.resolve(path.dirname(documentPath), decodeURIComponent(target)))
        } catch {
            // Link validation reports malformed targets.
        }
    }
    return targets
}

function validateDocumentationBoundaries() {
    const markdownFiles = listFiles(root, file => file.endsWith('.md'), shouldSkipDirectory)
    for (const markdownPath of markdownFiles) {
        if (isWithin(markdownPath, docsDir)) continue
        if (markdownPath === path.join(root, 'README.md')) continue
        if (markdownPath === path.join(root, 'AGENTS.md')) continue
        if (isSkillResource(markdownPath)) continue
        errors.push(`${relative(markdownPath)} is human-maintained Markdown outside docs/`)
    }
}

function validateAgentPolicyLocation() {
    const agentFiles = listFiles(root, file => path.basename(file) === 'AGENTS.md', shouldSkipDirectory)
    const expected = path.join(root, 'AGENTS.md')
    if (agentFiles.length !== 1 || agentFiles[0] !== expected) {
        errors.push(`Expected only root AGENTS.md; found: ${agentFiles.map(relative).join(', ') || 'none'}`)
    }
}

function isSkillResource(filePath) {
    return isWithin(filePath, path.join(root, '.agents', 'skills'))
}

function shouldSkipDirectory(directoryPath) {
    const name = path.basename(directoryPath)
    return name === '.git'
        || name === 'node_modules'
        || name === 'dist'
        || name === 'dist-web'
        || name === '.expo'
        || name === 'test-results'
        || name === 'playwright-report'
        || isWithin(directoryPath, path.join(root, 'Docker', 'compose', 'server'))
}

function listFiles(directoryPath, includeFile, skipDirectory = () => false) {
    const output = []
    if (!fs.existsSync(directoryPath)) return output
    for (const entry of fs.readdirSync(directoryPath, {withFileTypes: true})) {
        const fullPath = path.join(directoryPath, entry.name)
        if (entry.isDirectory()) {
            if (!skipDirectory(fullPath)) output.push(...listFiles(fullPath, includeFile, skipDirectory))
        } else if (entry.isFile() && includeFile(fullPath)) {
            output.push(fullPath)
        }
    }
    return output
}

function isWithin(filePath, directoryPath) {
    const relation = path.relative(directoryPath, filePath)
    return relation === '' || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation))
}

function relative(filePath) {
    return path.relative(root, filePath) || '.'
}

function fail(message) {
    console.error(message)
    process.exit(1)
}
