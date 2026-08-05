import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'avs_bot_models.dart';

class AvsBotPrivacyNotice extends StatelessWidget {
  const AvsBotPrivacyNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const ExpansionTile(
        initiallyExpanded: true,
        leading: Icon(Icons.shield_outlined),
        title: Text('Private, role-aware and read-only'),
        subtitle: Text('AVS Bot may make mistakes. Check important details.'),
        childrenPadding: EdgeInsets.fromLTRB(20, 0, 20, 16),
        children: [
          Text(
            'Only information permitted for your signed-in AVS role is sent through the secure backend. AVS Bot cannot change college records. Do not share passwords, API keys, medical records, or unnecessary personal information.',
          ),
        ],
      ),
    );
  }
}

class AvsBotOfflineBanner extends StatelessWidget {
  const AvsBotOfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialBanner(
      leading: const Icon(Icons.cloud_off_outlined),
      content: const Text(
        'Offline view — showing encrypted content cached on this device.',
      ),
      actions: const [SizedBox.shrink()],
    );
  }
}

class AvsBotEmptyState extends StatelessWidget {
  const AvsBotEmptyState({
    super.key,
    required this.questions,
    required this.onQuestion,
  });

  final List<String> questions;
  final ValueChanged<String> onQuestion;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.auto_awesome_outlined,
                size: 56,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 14),
              Text(
                'How can AVS Bot help?',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Ask about your authorised attendance, subjects, AVS Learn and Skill content, campus locations, issues, announcements, profile, or feedback process.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 18),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                runSpacing: 8,
                children: questions
                    .map(
                      (question) => ActionChip(
                        avatar: const Icon(Icons.chat_outlined, size: 18),
                        label: Text(question),
                        onPressed: () => onQuestion(question),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AvsBotMessageBubble extends StatelessWidget {
  const AvsBotMessageBubble({
    super.key,
    required this.message,
    required this.onFeedback,
    required this.onReport,
    required this.onRetry,
    required this.onAction,
  });

  final AvsBotMessage message;
  final ValueChanged<String> onFeedback;
  final VoidCallback onReport;
  final VoidCallback onRetry;
  final ValueChanged<AvsBotAction> onAction;

  @override
  Widget build(BuildContext context) {
    final assistant = message.isAssistant;
    final colors = Theme.of(context).colorScheme;
    return Align(
      alignment: assistant ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 760),
        margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: assistant
              ? colors.surfaceContainerHigh
              : colors.primaryContainer,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: message.status == 'FAILED'
                ? colors.error
                : colors.outlineVariant,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  assistant ? Icons.auto_awesome : Icons.person_outline,
                  size: 18,
                ),
                const SizedBox(width: 6),
                Text(
                  assistant ? 'AVS Bot' : 'You',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                if (message.isStreaming) ...[
                  const SizedBox(width: 10),
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ],
              ],
            ),
            if (message.content.isNotEmpty) ...[
              const SizedBox(height: 9),
              SelectableText(message.content),
            ],
            if (message.sources.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Sources', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 5),
              ...message.sources.map(
                (source) => Card(
                  margin: const EdgeInsets.only(bottom: 6),
                  child: ListTile(
                    dense: true,
                    leading: const Icon(Icons.description_outlined),
                    title: Text(source.title),
                    subtitle: Text(
                      [
                        if (source.category != null) source.category!,
                        if (source.version != null) 'v${source.version}',
                      ].join(' • '),
                    ),
                  ),
                ),
              ),
            ],
            if (message.actions.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: message.actions
                    .where((action) => action.isAllowed)
                    .map(
                      (action) => ActionChip(
                        avatar: const Icon(Icons.open_in_new, size: 17),
                        label: Text(action.label),
                        onPressed: () => onAction(action),
                      ),
                    )
                    .toList(),
              ),
            ],
            if (assistant && !message.isStreaming) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 2,
                children: [
                  IconButton(
                    tooltip: 'Copy',
                    visualDensity: VisualDensity.compact,
                    onPressed: message.content.isEmpty
                        ? null
                        : () => Clipboard.setData(
                            ClipboardData(text: message.content),
                          ),
                    icon: const Icon(Icons.copy_outlined, size: 19),
                  ),
                  IconButton(
                    tooltip: 'Helpful',
                    visualDensity: VisualDensity.compact,
                    onPressed: () => onFeedback('HELPFUL'),
                    icon: Icon(
                      message.feedback == 'HELPFUL'
                          ? Icons.thumb_up
                          : Icons.thumb_up_outlined,
                      size: 19,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Not helpful',
                    visualDensity: VisualDensity.compact,
                    onPressed: () => onFeedback('NOT_HELPFUL'),
                    icon: Icon(
                      message.feedback == 'NOT_HELPFUL'
                          ? Icons.thumb_down
                          : Icons.thumb_down_outlined,
                      size: 19,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Report',
                    visualDensity: VisualDensity.compact,
                    onPressed: onReport,
                    icon: const Icon(Icons.flag_outlined, size: 19),
                  ),
                  if (message.status == 'FAILED' ||
                      message.status == 'CANCELLED')
                    IconButton(
                      tooltip: 'Retry',
                      visualDensity: VisualDensity.compact,
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh, size: 20),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class AvsBotComposer extends StatelessWidget {
  const AvsBotComposer({
    super.key,
    required this.controller,
    required this.sending,
    required this.onSend,
    required this.onCancel,
    required this.onChanged,
  });

  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onCancel;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border(
            top: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: !sending,
                minLines: 1,
                maxLines: 6,
                maxLength: 8000,
                onChanged: onChanged,
                onSubmitted: (_) {
                  if (!sending) onSend();
                },
                decoration: const InputDecoration(
                  labelText: 'Ask AVS Bot',
                  hintText: 'Ask about information available to your AVS role',
                  counterText: '',
                  prefixIcon: Icon(Icons.auto_awesome_outlined),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              tooltip: sending ? 'Cancel response' : 'Send',
              onPressed: sending ? onCancel : onSend,
              icon: Icon(sending ? Icons.stop : Icons.send),
            ),
          ],
        ),
      ),
    );
  }
}
