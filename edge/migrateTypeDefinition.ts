import * as _ from 'lodash'
import * as ts from 'typescript'
import { createNodeMatcher, findPropTypeModuleName } from './migrateReactClass'

export default function (originalCode: string) {
	const codeTree = ts.createSourceFile('file.tsx', originalCode, ts.ScriptTarget.ESNext, true)

	const propTypeModule = findPropTypeModuleName(codeTree)

	const classListWithoutPropDefinitions = findClassListWithoutPropDefinitions(codeTree)

	_.forEachRight(classListWithoutPropDefinitions, classNode => {
		const staticPropType = findStaticPropType(classNode.members)
		if (!staticPropType) {
			return null
		}

		// Remove the old `static propTypes = { ... }`
		originalCode = originalCode.substring(0, staticPropType.node.pos) + originalCode.substring(staticPropType.node.end)

		const propList = []
		_.forEach(staticPropType.members, workNode => {
			if (ts.isPropertyAssignment(workNode) === false) {
				return null
			}
			const { name, initializer: value } = workNode as ts.PropertyAssignment

			// Preserve single-line comments
			const comments = workNode.getFullText()
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.startsWith('//'))
			if (comments.length > 0 && propList.length > 0) {
				comments.unshift('')
			}
			propList.push(...comments)

			const { type, required } = getCorrespondingTypeDefinition(value)
			propList.push(name.getText() + (required ? '' : '?') + ': ' + type)
		})

		let cursor = classNode.heritageClauses[0].types[0].expression.end + 1
		const newLine = propList.some(item => item.startsWith('//'))
		let propText = (
			'{' + (newLine ? '\n' : ' ') +
			propList.join(newLine ? '\n' : ', ') +
			(newLine ? '\n' : ' ') + '}'
		)
		if (classNode.heritageClauses[0].types[0].typeArguments === undefined) {
			cursor -= 1
			propText = '<' + propText + '>'
		}
		originalCode = originalCode.substring(0, cursor) + propText + originalCode.substring(cursor)
	})

	if (propTypeModule.node) {
		originalCode = originalCode.substring(0, propTypeModule.node.pos) + originalCode.substring(propTypeModule.node.end)
	}

	return originalCode

	function getCorrespondingTypeDefinition(workNode: ts.Node) {
		const propNode = findPropType(workNode, propTypeModule.name)
		if (!propNode) {
			return null
		}

		let corrType = propNode.name.text
		if (corrType === 'bool') {
			corrType = 'boolean'
		} else if (corrType === 'func') {
			corrType = '() => void'
		} else if (corrType === 'array') {
			corrType = 'Array<any>'
		} else if (propNode.name.text === 'node') {
			corrType = 'React.ReactNode'
		} else if (propNode.name.text === 'element') {
			corrType = 'JSX.Element'
		}

		if (ts.isCallExpression(propNode.parent) && propNode.parent.arguments.length > 0) {
			if (corrType === 'arrayOf') {
				corrType = 'Array<' + getCorrespondingTypeDefinition(propNode.parent.arguments[0]).type + '>'
			} else if (corrType === 'instanceOf') {
				corrType = propNode.parent.arguments[0].getText()
			} else if (corrType === 'objectOf') {
				corrType = '{ [string]: ' + getCorrespondingTypeDefinition(propNode.parent.arguments[0]).type + ' }'
			} else if (propNode.name.text === 'oneOf' && ts.isArrayLiteralExpression(propNode.parent.arguments[0])) {
				const typeNode = propNode.parent.arguments[0] as ts.ArrayLiteralExpression
				corrType = _.chain(typeNode.elements)
					.map(node => {
						if (ts.isStringLiteral(node)) {
							return '"' + node.text + '"'
						} else {
							return node.getText()
						}
					})
					.compact()
					.value()
					.join(' | ')
			} else if (propNode.name.text === 'oneOfType' && ts.isArrayLiteralExpression(propNode.parent.arguments[0])) {
				const typeNode = propNode.parent.arguments[0] as ts.ArrayLiteralExpression
				corrType = _.chain(typeNode.elements)
					.map(node => getCorrespondingTypeDefinition(node))
					.map('type')
					.flatten()
					.compact()
					.value()
					.join(' | ')
			} else if (propNode.name.text === 'shape' && ts.isObjectLiteralExpression(propNode.parent.arguments[0])) {
				const typeNode = propNode.parent.arguments[0] as ts.ObjectLiteralExpression
				corrType = (
					'{ ' +
					typeNode.properties
						.map((node: ts.PropertyAssignment) => node.name.getText() + ': ' + getCorrespondingTypeDefinition(node.initializer).type)
						.join(', ') +
					' }'
				)
			}
		}

		if (!corrType) {
			return null
		}

		const required = _.get(propNode, 'parent.name.text') === 'isRequired'

		return { type: corrType, required }
	}
}

const findClassListWithoutPropDefinitions = createNodeMatcher<Array<ts.ClassDeclaration>>(
	() => [],
	(node, results) => {
		if (
			ts.isClassDeclaration(node) &&
			node.heritageClauses &&
			ts.isHeritageClause(node.heritageClauses[0]) &&
			node.heritageClauses[0].types.length > 0 &&
			ts.isExpressionWithTypeArguments(node.heritageClauses[0].types[0]) &&
			node.heritageClauses[0].types[0].typeArguments === undefined
		) {
			const stub = node.heritageClauses[0].types[0].expression as ts.PropertyAccessExpression
			if (
				ts.isIdentifier(stub.expression) &&
				stub.expression.text === 'React' &&
				(stub.name.text === 'Component' || stub.name.text === 'PureComponent')
			) {
				results.push(node)
				return results
			}
		}
	}
)

const findStaticPropType = (nodeList: ts.NodeArray<ts.ClassElement>) => {
	const matcher = createNodeMatcher<{ node: ts.PropertyDeclaration, members: ts.NodeArray<ts.ObjectLiteralElementLike> }>(
		() => undefined,
		(node) => {
			if (
				ts.isPropertyDeclaration(node) &&
				node.modifiers &&
				node.modifiers[0].kind === ts.SyntaxKind.StaticKeyword &&
				ts.isIdentifier(node.name) &&
				node.name.text === 'propTypes' &&
				node.initializer &&
				ts.isObjectLiteralExpression(node.initializer)
			) {
				return { node, members: node.initializer.properties }
			}
		}
	)
	return _.last(_.compact(nodeList.map(node => matcher(node))))
}

const findPropType = (node: ts.Node, moduleName: string) => createNodeMatcher<ts.PropertyAccessExpression>(
	() => undefined,
	(node) => {
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === moduleName
		) {
			return node
		}
	}
)(node)