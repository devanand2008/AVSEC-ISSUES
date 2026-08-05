import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import 'avs_bot_repository.dart';

class AvsBotAdminScreen extends StatelessWidget {
  const AvsBotAdminScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  Widget build(BuildContext context) {
    final repository = AvsBotRepository(client: client);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('AVS Bot administration'),
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(icon: Icon(Icons.analytics_outlined), text: 'Dashboard'),
              Tab(icon: Icon(Icons.library_books_outlined), text: 'Knowledge'),
              Tab(icon: Icon(Icons.settings_outlined), text: 'Settings'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _AiAdminDashboard(repository: repository),
            _AiKnowledgeScreen(repository: repository),
            _AiAdminSettings(repository: repository),
          ],
        ),
      ),
    );
  }
}

class _AiAdminDashboard extends StatefulWidget {
  const _AiAdminDashboard({required this.repository});

  final AvsBotRepository repository;

  @override
  State<_AiAdminDashboard> createState() => _AiAdminDashboardState();
}

class _AiAdminDashboardState extends State<_AiAdminDashboard> {
  Map<String, dynamic>? _data;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final value = await widget.repository.adminDashboard();
      if (mounted) setState(() => _data = value);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Could not load AVS Bot dashboard: $_error'),
            const SizedBox(height: 10),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (data == null) return const Center(child: CircularProgressIndicator());
    final usage = data['usage'] as Map? ?? const {};
    final totals = usage['totals'] as Map? ?? const {};
    final provider = data['provider'] as Map? ?? const {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _MetricCard(
                label: 'Requests (30 days)',
                value: '${totals['requests'] ?? 0}',
                icon: Icons.chat_outlined,
              ),
              _MetricCard(
                label: 'Input tokens',
                value: '${totals['inputTokens'] ?? 0}',
                icon: Icons.input,
              ),
              _MetricCard(
                label: 'Output tokens',
                value: '${totals['outputTokens'] ?? 0}',
                icon: Icons.output,
              ),
              _MetricCard(
                label: 'Estimated cost (USD)',
                value: '${totals['estimatedCostUsd'] ?? 0}',
                icon: Icons.payments_outlined,
              ),
              _MetricCard(
                label: 'Failures',
                value: '${totals['failures'] ?? 0}',
                icon: Icons.error_outline,
              ),
              _MetricCard(
                label: 'Average latency',
                value: totals['averageLatencyMs'] == null
                    ? '—'
                    : '${totals['averageLatencyMs']} ms',
                icon: Icons.timer_outlined,
              ),
            ],
          ),
          const SizedBox(height: 18),
          Card(
            child: ListTile(
              leading: Icon(
                provider['configured'] == true
                    ? Icons.check_circle_outline
                    : Icons.warning_amber_outlined,
              ),
              title: const Text('Provider configuration'),
              subtitle: Text(
                'Responses API • ${provider['model'] ?? 'model not configured'} • ${provider['knowledgeProvider'] ?? 'internal'}',
              ),
            ),
          ),
          _JsonSummary(title: 'Knowledge status', value: data['knowledge']),
          _JsonSummary(title: 'Response feedback', value: data['feedback']),
          _JsonSummary(title: 'Safety events (30 days)', value: data['safety']),
        ],
      ),
    );
  }
}

class _AiKnowledgeScreen extends StatefulWidget {
  const _AiKnowledgeScreen({required this.repository});

  final AvsBotRepository repository;

  @override
  State<_AiKnowledgeScreen> createState() => _AiKnowledgeScreenState();
}

class _AiKnowledgeScreenState extends State<_AiKnowledgeScreen> {
  List<Map<String, dynamic>>? _documents;
  Object? _error;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final documents = await widget.repository.knowledgeDocuments();
      if (mounted) {
        setState(() {
          _documents = documents;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _upload() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'docx', 'txt', 'md', 'html'],
      allowMultiple: false,
      withData: true,
    );
    final file = result?.files.singleOrNull;
    if (file == null || file.bytes == null) return;
    if (!mounted) return;
    final metadata = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => _KnowledgeMetadataDialog(
        suggestedTitle: file.name.replaceFirst(RegExp(r'\.[^.]+$'), ''),
      ),
    );
    if (metadata == null) return;
    setState(() => _uploading = true);
    try {
      await widget.repository.uploadKnowledge(
        fields: metadata,
        fileName: file.name,
        bytes: file.bytes!,
        contentType: _mimeType(file.extension),
      );
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Knowledge document processed and published.'),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  String _mimeType(String? extension) {
    return switch (extension?.toLowerCase()) {
      'pdf' => 'application/pdf',
      'docx' =>
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'md' => 'text/markdown',
      'html' => 'text/html',
      _ => 'text/plain',
    };
  }

  Future<void> _archive(Map<String, dynamic> document) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Archive knowledge document?'),
        content: Text(
          '${document['title']} will no longer be used in AVS Bot answers.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Archive'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.repository.archiveKnowledge('${document['id']}');
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final documents = _documents;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _uploading ? null : _upload,
        icon: _uploading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.upload_file),
        label: Text(_uploading ? 'Processing…' : 'Upload'),
      ),
      body: _error != null
          ? Center(child: Text('Could not load knowledge: $_error'))
          : documents == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: documents.isEmpty
                  ? ListView(
                      children: const [
                        SizedBox(height: 180),
                        Icon(Icons.library_books_outlined, size: 54),
                        SizedBox(height: 12),
                        Center(
                          child: Text('No published AVS Bot knowledge yet.'),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                      itemCount: documents.length,
                      itemBuilder: (context, index) {
                        final document = documents[index];
                        return Card(
                          child: ListTile(
                            leading: const Icon(Icons.description_outlined),
                            title: Text('${document['title']}'),
                            subtitle: Text(
                              '${document['category']} • ${document['status']} • ${document['source']} • v${document['version']}',
                            ),
                            trailing: IconButton(
                              tooltip: 'Archive',
                              onPressed: document['status'] == 'ARCHIVED'
                                  ? null
                                  : () => _archive(document),
                              icon: const Icon(Icons.archive_outlined),
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}

class _KnowledgeMetadataDialog extends StatefulWidget {
  const _KnowledgeMetadataDialog({required this.suggestedTitle});

  final String suggestedTitle;

  @override
  State<_KnowledgeMetadataDialog> createState() =>
      _KnowledgeMetadataDialogState();
}

class _KnowledgeMetadataDialogState extends State<_KnowledgeMetadataDialog> {
  late final TextEditingController _title;
  final _category = TextEditingController(text: 'GENERAL');
  final _roles = TextEditingController();
  final _version = TextEditingController(text: '1');

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.suggestedTitle);
  }

  @override
  void dispose() {
    _title.dispose();
    _category.dispose();
    _roles.dispose();
    _version.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Knowledge metadata'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _category,
              decoration: const InputDecoration(labelText: 'Category'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _version,
              decoration: const InputDecoration(labelText: 'Version'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _roles,
              decoration: const InputDecoration(
                labelText: 'Visible roles (optional, comma separated)',
                hintText: 'STUDENT,FACULTY,HOD',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (_title.text.trim().isEmpty || _category.text.trim().isEmpty) {
              return;
            }
            Navigator.of(context).pop({
              'title': _title.text.trim(),
              'category': _category.text.trim(),
              'version': _version.text.trim(),
              if (_roles.text.trim().isNotEmpty)
                'roleVisibility': _roles.text.trim(),
            });
          },
          child: const Text('Upload and publish'),
        ),
      ],
    );
  }
}

class _AiAdminSettings extends StatefulWidget {
  const _AiAdminSettings({required this.repository});

  final AvsBotRepository repository;

  @override
  State<_AiAdminSettings> createState() => _AiAdminSettingsState();
}

class _AiAdminSettingsState extends State<_AiAdminSettings> {
  Map<String, dynamic>? _data;
  late final TextEditingController _model;
  late final TextEditingController _tokens;
  late final TextEditingController _budget;
  bool _enabled = false;
  String _provider = 'internal';
  bool _saving = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _model = TextEditingController();
    _tokens = TextEditingController();
    _budget = TextEditingController();
    _load();
  }

  @override
  void dispose() {
    _model.dispose();
    _tokens.dispose();
    _budget.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.repository.adminSettings();
      final effective = data['effective'] as Map? ?? const {};
      if (!mounted) return;
      setState(() {
        _data = data;
        _enabled = effective['enabled'] as bool? ?? false;
        _provider = effective['knowledgeProvider']?.toString() ?? 'internal';
        _model.text = effective['model']?.toString() ?? '';
        _tokens.text = '${effective['maxOutputTokens'] ?? 1200}';
        _budget.text = effective['monthlyBudget']?.toString() ?? '';
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.repository.updateAdminSettings({
        'enabled': _enabled,
        if (_model.text.trim().isNotEmpty) 'model': _model.text.trim(),
        'maxOutputTokens': int.tryParse(_tokens.text) ?? 1200,
        if (_budget.text.trim().isNotEmpty)
          'monthlyBudget': double.tryParse(_budget.text),
        'knowledgeProvider': _provider,
      });
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Settings saved.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _test() async {
    setState(() => _saving = true);
    try {
      final result = await widget.repository.testConnection();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              result['ok'] == true
                  ? 'OpenAI Responses API connection succeeded.'
                  : 'Connection failed: ${result['category']}',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(child: Text('Could not load AVS Bot settings: $_error'));
    }
    if (_data == null) return const Center(child: CircularProgressIndicator());
    final secrets = _data!['secrets'] as Map? ?? const {};
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        SwitchListTile(
          value: _enabled,
          title: const Text('Enable AVS Bot for this college'),
          subtitle: const Text(
            'Requires a newly generated server-side key and a model available to the OpenAI project.',
          ),
          onChanged: _saving
              ? null
              : (value) => setState(() => _enabled = value),
        ),
        ListTile(
          leading: const Icon(Icons.key_outlined),
          title: const Text('Server key'),
          subtitle: Text(
            secrets['apiKeyPresent'] == true
                ? 'Present on backend (value is never displayed)'
                : 'Not configured',
          ),
        ),
        TextField(
          controller: _model,
          decoration: const InputDecoration(
            labelText: 'OpenAI model',
            helperText:
                'Enter a model confirmed available to the backend OpenAI project.',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _tokens,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Maximum output tokens'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _budget,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(
            labelText: 'Monthly budget (USD, optional)',
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _provider,
          decoration: const InputDecoration(labelText: 'Knowledge provider'),
          items: const [
            DropdownMenuItem(
              value: 'internal',
              child: Text('Internal role-filtered knowledge'),
            ),
            DropdownMenuItem(
              value: 'openai_file_search',
              child: Text('OpenAI file search (college-wide files only)'),
            ),
          ],
          onChanged: _saving
              ? null
              : (value) {
                  if (value != null) setState(() => _provider = value);
                },
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 10,
          children: [
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: const Text('Save'),
            ),
            OutlinedButton.icon(
              onPressed: _saving ? null : _test,
              icon: const Icon(Icons.network_check),
              label: const Text('Test connection'),
            ),
          ],
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 210,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon),
              const SizedBox(height: 12),
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              Text(label),
            ],
          ),
        ),
      ),
    );
  }
}

class _JsonSummary extends StatelessWidget {
  const _JsonSummary({required this.title, required this.value});

  final String title;
  final dynamic value;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        title: Text(title),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [SelectableText('$value')],
      ),
    );
  }
}
