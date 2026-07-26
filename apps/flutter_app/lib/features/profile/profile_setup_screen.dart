import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import '../auth/auth_user.dart';

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({
    super.key,
    required this.client,
    required this.user,
    required this.onSubmitted,
  });

  final AvsApiClient client;
  final AuthUser user;
  final ValueChanged<AuthUser> onSubmitted;

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _dateOfBirth = TextEditingController();
  final _collegeId = TextEditingController();
  final _registerNumber = TextEditingController();
  final _mobile = TextEditingController();
  final _whatsapp = TextEditingController();
  final _parentName = TextEditingController();
  final _parentMobile = TextEditingController();
  final _emergency = TextEditingController();
  final _address = TextEditingController();
  final _employeeId = TextEditingController();
  final _designation = TextEditingController();
  final _qualification = TextEditingController();
  final _specialization = TextEditingController();
  final _dateOfJoining = TextEditingController();
  final _shift = TextEditingController();
  int _step = 0;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _gender;
  String _profileKind = 'STUDENT';
  String? _departmentId;
  String? _lockedDepartmentLabel;
  String? _programmeId;
  String? _academicYearId;
  String? _studyYear;
  String? _semesterId;
  String? _sectionId;
  List<_Option> _departments = const [];
  List<_Option> _programmes = const [];
  List<_Option> _years = const [];
  List<_Option> _semesters = const [];
  List<_Option> _sections = const [];

  @override
  void initState() {
    super.initState();
    _fullName.text = widget.user.fullName;
    _load();
  }

  Future<void> _load() async {
    try {
      final values = await Future.wait([
        widget.client.get('/users/me/profile-requirements'),
        widget.client.get('/academic/departments'),
        widget.client.get('/academic/years'),
      ]);
      final requirements = values[0] as Map<String, dynamic>;
      _profileKind =
          requirements['profileKind']?.toString().toUpperCase() ?? 'STUDENT';
      final locked =
          (requirements['lockedValues'] as Map<String, dynamic>?) ?? const {};
      final department = locked['department'] as Map<String, dynamic>?;
      _departmentId = department?['id'] as String?;
      _lockedDepartmentLabel = department == null
          ? null
          : '${department['code']} - ${department['name']}';
      _fullName.text =
          locked['fullName'] as String? ?? widget.user.fullName;
      _studyYear = (locked['studyYear'] as num?)?.toInt().toString();
      _departments = _options(values[1]);
      _years = _options(values[2]);
      if (_departmentId != null) await _loadProgrammes(_departmentId!);
    } catch (error) {
      _error = '$error';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<_Option> _options(dynamic value) {
    return (value as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(_Option.fromJson)
        .toList();
  }

  Future<void> _loadProgrammes(String departmentId) async {
    final data =
        await widget.client.get('/academic/programmes?departmentId=$departmentId');
    if (mounted) setState(() => _programmes = _options(data));
  }

  Future<void> _loadSemesters() async {
    if (_programmeId == null || _academicYearId == null) return;
    final data = await widget.client.get(
      '/academic/semesters?programmeId=$_programmeId&academicYearId=$_academicYearId',
    );
    if (mounted) {
      setState(() {
        _semesters = _options(data);
        _semesterId = null;
        _sectionId = null;
        _sections = const [];
      });
    }
  }

  Future<void> _loadSections(String semesterId) async {
    final data =
        await widget.client.get('/academic/sections?semesterId=$semesterId');
    if (mounted) {
      setState(() {
        _sections = _options(data);
        _sectionId = null;
      });
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.post(
        '/users/me/profile/submit',
        _profileKind == 'STUDENT'
            ? {
                'fullName': _fullName.text.trim(),
                'dateOfBirth': _dateOfBirth.text.trim(),
                'gender': _gender,
                'collegeId': _collegeId.text.trim(),
                'registerNumber': _registerNumber.text.trim(),
                'departmentId': _departmentId,
                'programmeId': _programmeId,
                'academicYearId': _academicYearId,
                'studyYear': _studyYear,
                'semesterId': _semesterId,
                'sectionId': _sectionId,
                'mobileNumber': _mobile.text.trim(),
                'whatsappNumber': _whatsapp.text.trim(),
                'parentName': _parentName.text.trim(),
                'parentMobileNumber': _parentMobile.text.trim(),
                'emergencyContact': _emergency.text.trim(),
                'address': _address.text.trim(),
              }
            : {
                'fullName': _fullName.text.trim(),
                'employeeId': _employeeId.text.trim(),
                'mobileNumber': _mobile.text.trim(),
                'whatsappNumber': _whatsapp.text.trim(),
                'designation': _designation.text.trim(),
                'qualification': _qualification.text.trim(),
                'specialization': _specialization.text.trim(),
                'dateOfJoining': _dateOfJoining.text.trim(),
                'shift': _shift.text.trim(),
                'emergencyContact': _emergency.text.trim(),
              },
      );
      final refreshed =
          AuthUser.fromJson(await widget.client.get('/auth/me') as Map<String, dynamic>);
      widget.onSubmitted(refreshed);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _fullName,
      _dateOfBirth,
      _collegeId,
      _registerNumber,
      _mobile,
      _whatsapp,
      _parentName,
      _parentMobile,
      _emergency,
      _address,
      _employeeId,
      _designation,
      _qualification,
      _specialization,
      _dateOfJoining,
      _shift,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_profileKind != 'STUDENT') return _staffProfile();
    return Scaffold(
      appBar: AppBar(title: const Text('Complete profile')),
      body: Form(
        key: _formKey,
        child: Stepper(
          currentStep: _step,
          onStepTapped: (value) => setState(() => _step = value),
          onStepContinue: _step == 2
              ? (_busy ? null : _submit)
              : () => setState(() => _step += 1),
          onStepCancel:
              _step == 0 ? null : () => setState(() => _step -= 1),
          controlsBuilder: (context, details) => Padding(
            padding: const EdgeInsets.only(top: 18),
            child: Row(
              children: [
                FilledButton.icon(
                  onPressed: details.onStepContinue,
                  icon: Icon(_step == 2 ? Icons.send : Icons.arrow_forward),
                  label: Text(_step == 2 ? 'Submit profile' : 'Continue'),
                ),
                if (details.onStepCancel != null) ...[
                  const SizedBox(width: 10),
                  TextButton(
                    onPressed: details.onStepCancel,
                    child: const Text('Back'),
                  ),
                ],
              ],
            ),
          ),
          steps: [
            Step(
              title: const Text('Identity'),
              isActive: _step >= 0,
              content: Column(
                children: [
                  _requiredField(_fullName, 'Full name', Icons.person_outline),
                  const SizedBox(height: 12),
                  _requiredField(
                    _dateOfBirth,
                    'Date of birth (YYYY-MM-DD)',
                    Icons.cake_outlined,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _gender,
                    decoration: const InputDecoration(
                      labelText: 'Gender',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'MALE', child: Text('Male')),
                      DropdownMenuItem(value: 'FEMALE', child: Text('Female')),
                      DropdownMenuItem(value: 'OTHER', child: Text('Other')),
                    ],
                    onChanged: (value) => setState(() => _gender = value),
                    validator: (value) => value == null ? 'Select gender.' : null,
                  ),
                ],
              ),
            ),
            Step(
              title: const Text('College information'),
              isActive: _step >= 1,
              content: Column(
                children: [
                  _requiredField(
                    _collegeId,
                    'College ID',
                    Icons.account_box_outlined,
                  ),
                  const SizedBox(height: 12),
                  _requiredField(
                    _registerNumber,
                    'Register number',
                    Icons.numbers,
                  ),
                  const SizedBox(height: 12),
                  if (_lockedDepartmentLabel != null)
                    InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Department',
                        prefixIcon: Icon(Icons.domain_outlined),
                      ),
                      child: Text(_lockedDepartmentLabel!),
                    )
                  else
                    _optionField(
                      'Department',
                      _departmentId,
                      _departments,
                      (value) async {
                        setState(() {
                          _departmentId = value;
                          _programmeId = null;
                        });
                        if (value != null) await _loadProgrammes(value);
                      },
                    ),
                  const SizedBox(height: 12),
                  _optionField('Programme', _programmeId, _programmes,
                      (value) async {
                    setState(() => _programmeId = value);
                    await _loadSemesters();
                  }),
                  const SizedBox(height: 12),
                  _optionField('Academic year', _academicYearId, _years,
                      (value) async {
                    setState(() => _academicYearId = value);
                    await _loadSemesters();
                  }),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _studyYear,
                    decoration:
                        const InputDecoration(labelText: 'Study year'),
                    items: const [
                      DropdownMenuItem(value: '1', child: Text('First Year')),
                      DropdownMenuItem(value: '2', child: Text('Second Year')),
                      DropdownMenuItem(value: '3', child: Text('Third Year')),
                      DropdownMenuItem(value: '4', child: Text('Fourth Year')),
                    ],
                    onChanged: (value) => setState(() => _studyYear = value),
                    validator: (value) =>
                        value == null ? 'Select study year.' : null,
                  ),
                  const SizedBox(height: 12),
                  _optionField('Semester', _semesterId, _semesters,
                      (value) async {
                    setState(() => _semesterId = value);
                    if (value != null) await _loadSections(value);
                  }),
                  const SizedBox(height: 12),
                  _optionField(
                    'Section',
                    _sectionId,
                    _sections,
                    (value) async => setState(() => _sectionId = value),
                  ),
                ],
              ),
            ),
            Step(
              title: const Text('Contact and guardian'),
              isActive: _step >= 2,
              content: Column(
                children: [
                  _requiredField(_mobile, 'Mobile number', Icons.phone_outlined),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _whatsapp,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'WhatsApp number',
                      prefixIcon: Icon(Icons.chat_outlined),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _parentName,
                    decoration:
                        const InputDecoration(labelText: 'Parent or guardian'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _parentMobile,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Parent or guardian mobile',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _emergency,
                    keyboardType: TextInputType.phone,
                    decoration:
                        const InputDecoration(labelText: 'Emergency contact'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _address,
                    maxLines: 3,
                    decoration:
                        const InputDecoration(labelText: 'Postal address'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _error!,
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _staffProfile() {
    return Scaffold(
      appBar: AppBar(title: const Text('Complete staff profile')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              widget.user.roles.join(' • ').replaceAll('_', ' '),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 14),
            _requiredField(_fullName, 'Full name', Icons.person_outline),
            const SizedBox(height: 12),
            InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Official email (locked)',
                prefixIcon: Icon(Icons.alternate_email),
              ),
              child: Text(widget.user.email ?? 'Not available'),
            ),
            if (_lockedDepartmentLabel != null) ...[
              const SizedBox(height: 12),
              InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Assigned department (locked)',
                  prefixIcon: Icon(Icons.domain_outlined),
                ),
                child: Text(_lockedDepartmentLabel!),
              ),
            ],
            const SizedBox(height: 12),
            _requiredField(
              _employeeId,
              'Employee ID',
              Icons.badge_outlined,
            ),
            const SizedBox(height: 12),
            _requiredField(
              _designation,
              'Designation',
              Icons.work_outline,
            ),
            const SizedBox(height: 12),
            _requiredField(
              _qualification,
              'Qualification',
              Icons.school_outlined,
            ),
            const SizedBox(height: 12),
            _requiredField(
              _specialization,
              'Specialisation',
              Icons.workspace_premium_outlined,
            ),
            const SizedBox(height: 12),
            _requiredField(
              _dateOfJoining,
              'Date of joining (YYYY-MM-DD)',
              Icons.calendar_month_outlined,
            ),
            const SizedBox(height: 12),
            _requiredField(_mobile, 'Mobile number', Icons.phone_outlined),
            const SizedBox(height: 12),
            TextField(
              controller: _whatsapp,
              keyboardType: TextInputType.phone,
              decoration:
                  const InputDecoration(labelText: 'WhatsApp number'),
            ),
            const SizedBox(height: 12),
            _requiredField(_shift, 'Shift', Icons.schedule_outlined),
            const SizedBox(height: 12),
            _requiredField(
              _emergency,
              'Emergency contact',
              Icons.emergency_outlined,
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _busy ? null : _submit,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
              label: const Text('Submit profile for verification'),
            ),
          ],
        ),
      ),
    );
  }

  TextFormField _requiredField(
    TextEditingController controller,
    String label,
    IconData icon,
  ) {
    return TextFormField(
      controller: controller,
      decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
      validator: (value) =>
          value == null || value.trim().isEmpty ? '$label is required.' : null,
    );
  }

  DropdownButtonFormField<String> _optionField(
    String label,
    String? value,
    List<_Option> options,
    Future<void> Function(String?) onChanged,
  ) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: options
          .map((option) => DropdownMenuItem(
                value: option.id,
                child: Text(option.label),
              ))
          .toList(),
      onChanged: onChanged,
      validator: (selected) => selected == null ? 'Select $label.' : null,
    );
  }
}

class _Option {
  const _Option(this.id, this.label);

  final String id;
  final String label;

  factory _Option.fromJson(Map<String, dynamic> json) {
    final code = json['code'] as String?;
    final name =
        json['name'] as String? ?? json['title'] as String? ?? 'Option';
    return _Option(
      json['id'] as String,
      code == null || code.isEmpty ? name : '$code - $name',
    );
  }
}
