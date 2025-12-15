/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptSizing, UserMessage } from '@vscode/prompt-tsx';
import { GraphitiRecallService } from '../../../memory/graphiti/node/graphitiRecallService';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { Tag } from '../base/tag';

export interface GraphitiMemoryContextProps extends BasePromptElementProps {
	readonly sessionId?: string;
	readonly query: string;
}

export class GraphitiMemoryContext extends PromptElement<GraphitiMemoryContextProps> {
	constructor(
		props: GraphitiMemoryContextProps,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super(props);
	}

	override async render(state: void, sizing: PromptSizing) {
		const facts = await this._instantiationService.createInstance(GraphitiRecallService).recallFacts({
			sessionId: this.props.sessionId,
			query: this.props.query,
		});
		if (!facts.length) {
			return <></>;
		}

		return (
			<UserMessage priority={this.props.priority}>
				<Tag name='graphiti_memory'>
					Recalled memory facts (Graphiti). Use as optional context; prefer the current conversation for the most up-to-date state.<br />
					{facts.map(({ scope, fact }) => <>- [{scope}] {fact.fact}<br /></>)}
				</Tag>
			</UserMessage>
		);
	}
}
