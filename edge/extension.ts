import * as vscode from 'vscode'
import migrateReactClass from './migrateReactClass'
// const migrateReactClass = require('./migrateReactClass')
// const migrateTypeDefinition = require('./migrateTypeDefinition')

export function activate(context) {
	context.subscriptions.push(vscode.commands.registerCommand('migrateToReactClass', async () => {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return vscode.window.showErrorMessage('No document opened.')
		}

		const document = editor.document
		try {
			const originalCode = document.getText()
			let modifiedCode = migrateReactClass(originalCode, document.languageId === 'typescriptreact' ? 'tsx' : 'jsx')

			await editor.edit(edit => edit.replace(
				new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end),
				modifiedCode
			))

			/* if (modifiedCode === '') {
				throw new Error('Could not migrate this document.')
			} */

			/* if (document.languageId === 'typescriptreact') {
				modifiedCode = migrateTypeDefinition(modifiedCode)
			} */

			/* if (originalCode !== modifiedCode) {
				await editor.edit(edit => {
					const editingRange = document.validateRange(new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
					edit.replace(editingRange, modifiedCode)
				})
				await vscode.commands.executeCommand('editor.action.formatDocument')
			} */

		} catch (error) {
			vscode.window.showErrorMessage(error.message)
			console.error(error)
		}
	}))
}

export function deactivate() { }
