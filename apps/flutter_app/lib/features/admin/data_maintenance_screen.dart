import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

class DataMaintenanceScreen extends StatefulWidget {
  const DataMaintenanceScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  State<DataMaintenanceScreen> createState() => _DataMaintenanceScreenState();
}

class _DataMaintenanceScreenState extends State<DataMaintenanceScreen> {
  final _beforeDate = TextEditingController();
  final _academicYear = TextEditingController();
  final _sourceSection = TextEditingController();
  final _targetSection = TextEditingController();
  final _targetYear = TextEditingController();
  final _backup = TextEditingController();
  final _confirmation = TextEditingController();
  final _reason = TextEditingController();
  List<Map<String, dynamic>> _categories = const [];
  List<Map<String, dynamic>> _history = const [];
  Map<String, dynamic>? _analysis;
  String? _category;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final controller in [
      _beforeDate,
      _academicYear,
      _sourceSection,
      _targetSection,
      _targetYear,
      _backup,
      _confirmation,
      _reason,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    await _run(() async {
      final values = await Future.wait([
        widget.client.get('/admin/data-maintenance/categories'),
        widget.client.get('/admin/data-maintenance/history'),
      ]);
      _categories = (values[0] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .toList();
      _history = (values[1] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .toList();
      _category ??= _categories.firstOrNull?['code']?.toString();
    });
  }

  Map<String, dynamic> _parameters() {
    return {
      'category': _category,
      if (_beforeDate.text.trim().isNotEmpty)
        'beforeDate': _beforeDate.text.trim(),
      if (_academicYear.text.trim().isNotEmpty)
        'academicYearId': _academicYear.text.trim(),
      if (_sourceSection.text.trim().isNotEmpty)
        'sourceSectionId': _sourceSection.text.trim(),
      if (_targetSection.text.trim().isNotEmpty)
        'targetSectionId': _targetSection.text.trim(),
      if (_targetYear.text.trim().isNotEmpty)
        'targetAcademicYearId': _targetYear.text.trim(),
    };
  }

  Future<void> _analyse() async {
    await _run(() async {
      _analysis = Map<String, dynamic>.from(
        await widget.client
            .post('/admin/data-maintenance/dry-run', _parameters()) as Map,
      );
      _confirmation.clear();
    });
  }

  Future<void> _execute() async {
    final analysis = _analysis;
    if (analysis == null) return;
    if (_backup.text.trim().length < 3 || _reason.text.trim().length < 10) {
      setState(() {
        _error =
            'Provide a verified backup reference and an operational reason of at least 10 characters.';
      });
      return;
    }
    await _run(() async {
      final id = analysis['id'].toString();
      await widget.client.post(
        '/admin/data-maintenance/$id/backup',
        {'backupReference': _backup.text.trim()},
      );
      await widget.client.post(
        '/admin/data-maintenance/$id/execute',
        {
          'backupReference': _backup.text.trim(),
          'confirmationPhrase': _confirmation.text.trim(),
          'reason': _reason.text.trim(),
        },
      );
      _analysis = null;
      _backup.clear();
      _confirmation.clear();
      _reason.clear();
      final raw = await widget.client.get('/admin/data-maintenance/history');
      _history =
          (raw as List<dynamic>).whereType<Map<String, dynamic>>().toList();
      _message('Maintenance job completed and audited.');
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      _error = error is AvsApiException
          ? error.message
          : 'The maintenance request could not be completed.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _categories
        .where((value) => value['code']?.toString() == _category)
        .firstOrNull;
    final required = (selected?['requires'] as List<dynamic>? ?? const [])
        .map((value) => value.toString())
        .toSet();
    return Scaffold(
      appBar: AppBar(title: const Text('Data maintenance wizard')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Card(
            child: ListTile(
              leading: Icon(Icons.admin_panel_settings_outlined),
              title: Text('Main Admin only'),
              subtitle: Text(
                'Every job starts with a fresh dry run, requires a verified backup reference, rechecks counts, and writes an audit trail. Permanent academic history deletion is disabled.',
              ),
            ),
          ),
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'Maintenance category'),
            items: _categories
                .map(
                  (value) => DropdownMenuItem(
                    value: value['code'].toString(),
                    child: Text(_label(value['code'].toString())),
                  ),
                )
                .toList(),
            onChanged: _busy
                ? null
                : (value) => setState(() {
                      _category = value;
                      _analysis = null;
                    }),
          ),
          const SizedBox(height: 12),
          if (required.contains('beforeDate'))
            TextField(
              controller: _beforeDate,
              decoration: const InputDecoration(
                labelText: 'Before date (ISO 8601)',
                hintText: '2026-01-01T00:00:00Z',
              ),
            ),
          if (required.contains('academicYearId'))
            _idField(_academicYear, 'Academic year UUID'),
          if (required.contains('sourceSectionId'))
            _idField(_sourceSection, 'Source section UUID'),
          if (required.contains('targetSectionId'))
            _idField(_targetSection, 'Target section UUID'),
          if (required.contains('targetAcademicYearId'))
            _idField(_targetYear, 'Target academic year UUID'),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _busy || _category == null ? null : _analyse,
            icon: const Icon(Icons.fact_check_outlined),
            label: const Text('Run fresh analysis'),
          ),
          if (_busy) const Padding(
            padding: EdgeInsets.only(top: 12),
            child: LinearProgressIndicator(),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_analysis != null) ...[
            const Divider(height: 36),
            Text('Dry-run result',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            for (final entry
                in (_analysis!['recordCounts'] as Map? ?? const {}).entries)
              ListTile(
                dense: true,
                title: Text(_label(entry.key.toString())),
                trailing: Text('${entry.value}'),
              ),
            const SizedBox(height: 8),
            const Text('Type this phrase exactly to continue:'),
            SelectableText(
              _analysis!['confirmationPhrase']?.toString() ?? '',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _backup,
              decoration: const InputDecoration(
                labelText: 'Verified backup reference',
                helperText: 'Example: backup job ID, immutable snapshot ID, or signed archive reference.',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmation,
              decoration:
                  const InputDecoration(labelText: 'Exact confirmation phrase'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reason,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'Operational reason',
              ),
            ),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              onPressed: _busy ? null : _execute,
              icon: const Icon(Icons.play_arrow),
              label: const Text('Register backup and execute'),
            ),
          ],
          const Divider(height: 40),
          Text('Recent audited jobs',
              style: Theme.of(context).textTheme.titleLarge),
          for (final item in _history.take(20))
            Card(
              child: ListTile(
                title: Text(_label(item['category']?.toString() ?? '')),
                subtitle: Text(
                  '${item['status'] ?? ''} • ${item['createdAt'] ?? ''}',
                ),
                trailing: Text(
                  (item['recordCounts'] as Map?)
                          ?.values
                          .whereType<num>()
                          .fold<num>(0, (sum, value) => sum + value)
                          .toString() ??
                      '0',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _idField(TextEditingController controller, String label) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        controller: controller,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }

  String _label(String value) {
    if (value.isEmpty) return value;
    final words = value.toLowerCase().split('_');
    return words
        .map((word) => word.isEmpty ? word : '${word[0].toUpperCase()}${word.substring(1)}')
        .join(' ');
  }

  void _message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}
