CREATE DATABASE Medcare
USE Medcare
select * from admissions
select * from admitted_patient_visits
select * from rooms
select * from admissions
CREATE TABLE admin (
    admin_id INT IDENTITY(1,1) PRIMARY KEY,
    admin_login_id AS ('A' + CAST(admin_id AS VARCHAR(10))) PERSISTED UNIQUE,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE()
);

INSERT INTO admin (username, password)
VALUES ('wajahat', '1234');


CREATE TABLE specializations (
    specialization_id INT IDENTITY(1,1) PRIMARY KEY,
    specialization_login_id AS ('S' + CAST(specialization_id AS VARCHAR(10))) PERSISTED UNIQUE,
    specialization_name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NULL
);
GO

INSERT INTO specializations (specialization_name, description)
VALUES
('Cardiology', 'Heart and cardiovascular specialist'),
('Neurology', 'Brain and nervous system specialist'),
('Orthopedics', 'Bone, joint, and muscle specialist'),
('Dermatology', 'Skin and hair specialist'),
('Pediatrics', 'Child health specialist');


CREATE TABLE doctors (
    doctor_id INT IDENTITY(10,10) PRIMARY KEY,
    doctor_login_id AS ('D' + CAST(doctor_id AS VARCHAR(10))) PERSISTED UNIQUE,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    age INT NOT NULL CHECK (age >= 18 AND age <= 100),
    specialization_id INT NOT NULL,
    consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (consultation_fee >= 0),
    phone_no VARCHAR(20),
    experience_years INT NOT NULL CHECK (experience_years >= 0),
    registration_number VARCHAR(50) UNIQUE,
    roomNo int, 
    CONSTRAINT FK_doctors_specializations FOREIGN KEY (specialization_id)
        REFERENCES specializations(specialization_id) 
);

CREATE SEQUENCE RoomNo_Seq
START WITH 1
INCREMENT BY 1;

CREATE TABLE patients (
    patient_id INT IDENTITY(1000,1) PRIMARY KEY,
    patient_login_id AS ('P' + CAST(patient_id AS VARCHAR(10))) PERSISTED UNIQUE,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    age INT NOT NULL CHECK (age >= 0 AND age <= 150),
    gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', 'Other')),
    blood_group VARCHAR(5) CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    phone_no VARCHAR(20),
    created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE receptionists (
    receptionist_id INT IDENTITY(5,1) PRIMARY KEY,
    receptionist_login_id AS ('R' + CAST(receptionist_id AS VARCHAR(10))) PERSISTED UNIQUE,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    contact_no VARCHAR(20),
    created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE signin_logs (
    log_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,      -- To store IDs like A1, D2, P3, etc.
    user_type VARCHAR(20) NOT NULL,    -- admin / doctor / patient / receptionist
    signin_datetime DATETIME DEFAULT GETDATE()
);

CREATE TABLE signup_logs (
    signup_log_id INT IDENTITY(1,1) PRIMARY KEY,
    patient_id INT NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    signup_datetime DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_signup_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE time_slots (
    slot_id INT IDENTITY(1,1) PRIMARY KEY,
    slot_number INT NOT NULL UNIQUE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL
);

INSERT INTO time_slots (slot_number, start_time, end_time) VALUES
(1, '06:00', '06:30'), (2, '06:30', '07:00'),
(3, '07:00', '07:30'), (4, '07:30', '08:00'),
(5, '08:00', '08:30'), (6, '08:30', '09:00'),
(7, '09:00', '09:30'), (8, '09:30', '10:00'),
(9, '10:00', '10:30'), (10, '10:30', '11:00'),
(11, '11:00', '11:30'), (12, '11:30', '12:00'),
(13, '12:00', '12:30'), (14, '12:30', '13:00'),
(15, '13:00', '13:30'), (16, '13:30', '14:00'),
(17, '14:00', '14:30'), (18, '14:30', '15:00'),
(19, '15:00', '15:30'), (20, '15:30', '16:00'),
(21, '16:00', '16:30'), (22, '16:30', '17:00'),
(23, '17:00', '17:30'), (24, '17:30', '18:00');
GO

CREATE TABLE doctor_schedules (
    schedule_id INT IDENTITY(1,1) PRIMARY KEY,
    doctor_id INT NOT NULL,
    day_of_week TINYINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    slot_id INT NOT NULL,
    is_active BIT DEFAULT 1,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_reg_schedule_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    CONSTRAINT FK_reg_schedule_slot FOREIGN KEY (slot_id) 
        REFERENCES time_slots(slot_id) ON DELETE CASCADE,
    CONSTRAINT UQ_reg_doctor_day_slot UNIQUE (doctor_id, day_of_week, slot_id)
);

CREATE TABLE removed_doctors (
    removed_doctor_id INT IDENTITY(1,1) PRIMARY KEY,
    doctor_id INT NOT NULL,
    doctor_name VARCHAR(100) NOT NULL,
    specialization_id INT NOT NULL,
    registration_number VARCHAR(50),
    removal_reason VARCHAR(500) NOT NULL,
    removed_by_admin_id INT NOT NULL,
    removal_date DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_removed_doctor_spec FOREIGN KEY (specialization_id) 
        REFERENCES specializations(specialization_id) ON DELETE NO ACTION,
    CONSTRAINT FK_removed_by_admin FOREIGN KEY (removed_by_admin_id) 
        REFERENCES admin(admin_id) ON DELETE NO ACTION
);

CREATE TABLE room_types (
    room_type_id INT IDENTITY(1,1) PRIMARY KEY,
    type_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255),
    per_day_charges DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (per_day_charges >= 0)
);
GO

select * from appointments
select * from appointment_forms;
CREATE TABLE rooms (
    room_id INT IDENTITY(1,1) PRIMARY KEY,
    room_number VARCHAR(20) NOT NULL UNIQUE,
    room_type_id INT NOT NULL,
    floor_number INT DEFAULT 1 CHECK (floor_number >= 0),
    CONSTRAINT FK_room_type FOREIGN KEY (room_type_id) 
        REFERENCES room_types(room_type_id) ON DELETE CASCADE
);


CREATE TABLE appointment_statuses (
    status_id INT IDENTITY(1,1) PRIMARY KEY,
    status_name VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO appointment_statuses (status_name) VALUES
('Scheduled'), ('Completed'), ('Cancelled');


CREATE TABLE appointments (
    appointment_id INT IDENTITY(1,1) PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    slot_id INT NULL,
    status_id INT NOT NULL DEFAULT 1,
    appointment_datetime DATETIME NULL,
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_appt_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE,
    CONSTRAINT FK_appt_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    CONSTRAINT FK_appt_slot FOREIGN KEY (slot_id) 
        REFERENCES time_slots(slot_id) ON DELETE SET NULL,
    CONSTRAINT FK_appt_status FOREIGN KEY (status_id) 
        REFERENCES appointment_statuses(status_id) ON DELETE NO ACTION,
    CONSTRAINT CHK_appt_slot_or_datetime CHECK (
        (slot_id IS NOT NULL AND appointment_datetime IS NULL) OR
        (slot_id IS NULL AND appointment_datetime IS NOT NULL)
    ),
    CONSTRAINT CHK_appt_future_date CHECK (appointment_date >= CAST(GETDATE() AS DATE))
);
GO





-- Trigger to ensure only available slots can be booked
CREATE TRIGGER trg_check_slot_availability
ON appointments
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Check if the slot is available for the doctor on the given date and day
    DECLARE @doctor_id INT, @appointment_date DATE, @slot_id INT, @day_of_week TINYINT;
    
    SELECT @doctor_id = doctor_id, 
           @appointment_date = appointment_date, 
           @slot_id = slot_id,
           @day_of_week = DATEPART(WEEKDAY, appointment_date) - 1
    FROM inserted;
    
    -- Only check for regular appointments (not emergency walk-ins)
    IF @slot_id IS NOT NULL
    BEGIN
        -- Check if doctor has this slot in their schedule for this day
        IF NOT EXISTS (
            SELECT 1 
            FROM doctor_schedules 
            WHERE doctor_id = @doctor_id 
              AND day_of_week = @day_of_week 
              AND slot_id = @slot_id 
              AND is_active = 1
        )
        BEGIN
            RAISERROR ('This slot is not available in the doctor''s schedule for this day.', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END
        
        -- Check if slot is already booked for this doctor on this date
        IF EXISTS (
            SELECT 1 
            FROM appointments 
            WHERE doctor_id = @doctor_id 
              AND appointment_date = @appointment_date 
              AND slot_id = @slot_id 
              AND status_id != 3  -- Not cancelled
        )
        BEGIN
            RAISERROR ('This slot is already booked for the selected doctor on this date.', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END
    END
    
    -- If all checks pass, insert the appointment
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, slot_id, status_id, appointment_datetime, created_at)
    SELECT patient_id, doctor_id, appointment_date, slot_id, status_id, appointment_datetime, created_at
    FROM inserted;
END;
GO

CREATE TABLE appointment_cancellations (
    cancellation_id INT IDENTITY(1,1) PRIMARY KEY,
    appointment_id INT NOT NULL,
    patient_id INT NOT NULL,
    cancellation_reason VARCHAR(500),
    cancelled_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_cancel_appointment FOREIGN KEY (appointment_id) 
        REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    CONSTRAINT FK_cancel_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE
);
GO


CREATE TABLE appointment_forms (
    form_id INT IDENTITY(1,1) PRIMARY KEY,
    appointment_id INT NOT NULL,
    patient_id INT NOT NULL,
    symptoms VARCHAR(1000) NOT NULL,
    medical_history VARCHAR(1000),
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_form_appointment FOREIGN KEY (appointment_id) 
        REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    CONSTRAINT FK_form_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE NO ACTION
);
GO

CREATE TABLE consultations (
    consultation_id INT IDENTITY(1,1) PRIMARY KEY,
    appointment_id INT NOT NULL UNIQUE,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    
    -- Vitals (Nullable based on your results)
    blood_pressure VARCHAR(20) NULL,
    temperature DECIMAL(4, 2) NULL,
    oxygen_saturation INT NULL,
    
    -- Consultation details
    diagnosis VARCHAR(500) NULL,
    consultation_date DATETIME DEFAULT GETDATE(),

    -- Foreign Key Constraints
    CONSTRAINT FK_cons_appointment FOREIGN KEY (appointment_id)
        REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    CONSTRAINT FK_cons_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON DELETE NO ACTION,
    CONSTRAINT FK_cons_patient FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON DELETE NO ACTION
);

CREATE TABLE prescribed_medicines (
    medicine_id INT IDENTITY(1,1) PRIMARY KEY,
    consultation_id INT NOT NULL,  -- Foreign Key linking to the consultation record
    medicine_name VARCHAR(100) NOT NULL,
    dosage VARCHAR(50) NOT NULL,
    frequency VARCHAR(50) NOT NULL,
    duration VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),

    -- Foreign Key Constraint to link to the consultations table
    CONSTRAINT FK_presc_med_consultation FOREIGN KEY (consultation_id)
        REFERENCES consultations(consultation_id) ON DELETE CASCADE
);

select * from prescribed_medicines
GO

CREATE TABLE action_types (
    action_type_id INT IDENTITY(1,1) PRIMARY KEY,
    action_name VARCHAR(50) NOT NULL UNIQUE
);
GO
INSERT INTO action_types (action_name) VALUES
('Admit'),
('X-Ray'),
('Blood Test'),
('Follow up checkup');

CREATE TABLE consultation_actions (
    action_id INT IDENTITY(1,1) PRIMARY KEY,
    consultation_id INT NOT NULL,
    action_type_id INT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Cancelled')),
    notes VARCHAR(500),
    created_at DATETIME DEFAULT GETDATE(),
    completed_at DATETIME NULL,
    
    CONSTRAINT FK_ca_consultation FOREIGN KEY (consultation_id) 
        REFERENCES consultations(consultation_id) ON DELETE CASCADE,
    CONSTRAINT FK_ca_action_type FOREIGN KEY (action_type_id) 
        REFERENCES action_types(action_type_id) ON DELETE NO ACTION
);

CREATE TABLE admissions (
    admission_id INT IDENTITY(1,1) PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    consultation_id INT NOT NULL,
    action_id INT NOT NULL,
    initial_room_id INT NOT NULL,
    admission_date DATETIME DEFAULT GETDATE(),
    discharge_date DATETIME NULL,
    is_active BIT DEFAULT 1,
    admission_notes VARCHAR(500),
    assigned_by_receptionist_id INT NOT NULL,
    
    CONSTRAINT FK_adm_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE,
    CONSTRAINT FK_adm_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors(doctor_id) ON DELETE NO ACTION,
    CONSTRAINT FK_adm_consultation FOREIGN KEY (consultation_id) 
        REFERENCES consultations(consultation_id) ON DELETE NO ACTION,
    CONSTRAINT FK_adm_action FOREIGN KEY (action_id) 
        REFERENCES consultation_actions(action_id) ON DELETE NO ACTION,
    CONSTRAINT FK_adm_room FOREIGN KEY (initial_room_id) 
        REFERENCES rooms(room_id) ON DELETE NO ACTION,
    CONSTRAINT FK_adm_receptionist FOREIGN KEY (assigned_by_receptionist_id) 
        REFERENCES receptionists(receptionist_id) ON DELETE NO ACTION,
    CONSTRAINT CHK_discharge_after_admission CHECK (discharge_date IS NULL OR discharge_date >= admission_date)
);
select * from admitted_patient_visits
CREATE TABLE admitted_patient_visits (
    visit_id INT IDENTITY(1,1) PRIMARY KEY,
    admission_id INT NOT NULL,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    visit_datetime DATETIME DEFAULT GETDATE(),
    
    blood_pressure VARCHAR(20),
    temperature DECIMAL(4,2) CHECK (temperature >= 90 AND temperature <= 110),
    oxygen_saturation INT CHECK (oxygen_saturation >= 0 AND oxygen_saturation <= 100),
    pulse_rate INT CHECK (pulse_rate >= 0 AND pulse_rate <= 300),
    
    condition_status VARCHAR(50) CHECK (condition_status IN ('Stable', 'Improving', 'Critical', 'Deteriorating')),
    notes VARCHAR(1000),
    treatment_given VARCHAR(500),
    
    ready_for_discharge BIT DEFAULT 0,
    discharge_recommended_date DATETIME NULL,
    
    created_at DATETIME DEFAULT GETDATE(),
    
    CONSTRAINT FK_apv_admission FOREIGN KEY (admission_id)
        REFERENCES admissions(admission_id) ON DELETE CASCADE,
    CONSTRAINT FK_apv_patient FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id) ON DELETE NO ACTION,
    CONSTRAINT FK_apv_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id) ON DELETE NO ACTION
);

CREATE TABLE discharges (
    discharge_id INT IDENTITY(1,1) PRIMARY KEY,
    admission_id INT NOT NULL UNIQUE,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    
    discharge_date DATETIME DEFAULT GETDATE(),
    total_days INT NOT NULL CHECK (total_days >= 0),
    
    room_charges DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (room_charges >= 0),
    medical_charges DECIMAL(10,2) DEFAULT 0 CHECK (medical_charges >= 0),
    doctor_visit_charges DECIMAL(10,2) DEFAULT 0 CHECK (doctor_visit_charges >= 0),
    lab_charges DECIMAL(10,2) DEFAULT 0 CHECK (lab_charges >= 0),
    other_charges DECIMAL(10,2) DEFAULT 0 CHECK (other_charges >= 0),
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    
    payment_status VARCHAR(20) DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid', 'Partial')),
    amount_paid DECIMAL(10,2) DEFAULT 0 CHECK (amount_paid >= 0),
    payment_date DATETIME NULL,
    
    final_diagnosis VARCHAR(1000),
    discharge_summary VARCHAR(2000),
    discharge_instructions VARCHAR(2000),
    follow_up_required BIT DEFAULT 0,
    follow_up_date DATE NULL,
    
    processed_by_receptionist_id INT NOT NULL,
    discharge_approved_by_visit_id INT NULL,
    
    CONSTRAINT FK_dis_admission FOREIGN KEY (admission_id) 
        REFERENCES admissions(admission_id) ON DELETE CASCADE,
    CONSTRAINT FK_dis_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE NO ACTION,
    CONSTRAINT FK_dis_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors(doctor_id) ON DELETE NO ACTION,
    CONSTRAINT FK_dis_receptionist FOREIGN KEY (processed_by_receptionist_id) 
        REFERENCES receptionists(receptionist_id) ON DELETE NO ACTION,
    CONSTRAINT FK_dis_visit FOREIGN KEY (discharge_approved_by_visit_id) 
        REFERENCES admitted_patient_visits(visit_id) ON DELETE NO ACTION,
);
GO

--==============================================================================
--EXECUTED TILL HERE
--==============================================================================


CREATE TABLE beds (
    bed_id INT IDENTITY(1,1) PRIMARY KEY,
    bed_code VARCHAR(30) NOT NULL UNIQUE,
    room_id INT NOT NULL,
    bed_number INT NOT NULL CHECK (bed_number > 0),
    is_occupied BIT DEFAULT 0,

    CONSTRAINT FK_bed_room FOREIGN KEY (room_id)
        REFERENCES rooms(room_id) ON DELETE CASCADE,

    CONSTRAINT UQ_room_bed UNIQUE (room_id, bed_number)
);
GO



ALTER TABLE admissions
ADD bed_id INT NOT NULL;
GO

ALTER TABLE admissions
ADD CONSTRAINT FK_adm_bed
FOREIGN KEY (bed_id)
REFERENCES beds(bed_id)
ON DELETE NO ACTION;
GO


INSERT INTO room_types (type_name, description, per_day_charges)
VALUES
-- Cardiology
('GWARD-CARD-M', 'General Ward Cardiology Male', 1500),
('GWARD-CARD-F', 'General Ward Cardiology Female', 1500),

-- Orthopedics
('GWARD-ORTHO-M', 'General Ward Orthopedics Male', 1400),
('GWARD-ORTHO-F', 'General Ward Orthopedics Female', 1400),

-- Neurology
('GWARD-NEURO-M', 'General Ward Neurology Male', 1600),
('GWARD-NEURO-F', 'General Ward Neurology Female', 1600),

-- Dermatology
('GWARD-DERMA-M', 'General Ward Dermatology Male', 1200),
('GWARD-DERMA-F', 'General Ward Dermatology Female', 1200),

-- Pediatrics (usually male/female separate if needed)
('GWARD-PED-M', 'General Ward Pediatrics Male', 1300),
('GWARD-PED-F', 'General Ward Pediatrics Female', 1300),

-- Optional Private Rooms
('PRIVATE ROOM', 'Private Standard Room', 4000);

-- General Wards → 8 beds each
INSERT INTO beds (bed_code, room_id, bed_number)
SELECT r.room_number + '-B' + CAST(n AS VARCHAR), r.room_id, n
FROM rooms r
CROSS APPLY (VALUES (1),(2),(3),(4),(5),(6),(7),(8)) AS n(n)
JOIN room_types rt ON r.room_type_id = rt.room_type_id
WHERE rt.type_name LIKE 'GWARD%';

-- Private Rooms → 1 bed each
INSERT INTO beds (bed_code, room_id, bed_number)
SELECT r.room_number + '-B1', r.room_id, 1
FROM rooms r
JOIN room_types rt ON r.room_type_id = rt.room_type_id
WHERE rt.type_name = 'PRIVATE%';




-- Cardiology Rooms
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('GW-CARD-M-1-01', 1, 1),
('GW-CARD-F-1-01', 2, 1);

-- Orthopedics Rooms
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('GW-ORTHO-M-2-01', 3, 2),
('GW-ORTHO-F-2-01', 4, 2);

-- Neurology Rooms
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('GW-NEURO-M-3-01', 5, 3),
('GW-NEURO-F-3-01', 6, 3);

-- Dermatology Rooms
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('GW-DERMA-M-4-01', 7, 4),
('GW-DERMA-F-4-01', 8, 4);

-- Pediatrics Rooms
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('GW-PED-M-5-01', 9, 5),
('GW-PED-F-5-01', 10, 5);

-- Private Room
INSERT INTO rooms (room_number, room_type_id, floor_number)
VALUES
('PR-6-01', 11, 6);

--=================================================================
select * from room_types
select * from rooms



INSERT INTO beds (bed_code, room_id, bed_number, is_occupied)
SELECT r.room_number + '-B' + CAST(n AS VARCHAR), r.room_id, n, 0
FROM rooms r
JOIN room_types rt ON r.room_type_id = rt.room_type_id
CROSS APPLY (VALUES (1),(2),(3),(4),(5),(6),(7),(8)) AS n(n)
WHERE rt.type_name LIKE 'GWARD%';

INSERT INTO beds (bed_code, room_id, bed_number, is_occupied)
SELECT r.room_number + '-B1', r.room_id, 1, 0
FROM rooms r
JOIN room_types rt ON r.room_type_id = rt.room_type_id
WHERE rt.type_name = 'PRIVATE ROOM';


select * from admissions
select * from admitted_patient_visits







--======================================================================
--VIEWS


-- MINIMAL WORKING MEDICAL REPORT VIEW
CREATE VIEW vw_minimal_medical_report AS
SELECT 
    -- Basic Info
    c.consultation_id,
    a.appointment_id,
    
    -- Patient
    p.patient_login_id,
    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
    
    -- Doctor
    CONCAT('Dr. ', d.first_name, ' ', d.last_name) AS doctor_name,
    s.specialization_name,
    
    -- Dates
    FORMAT(a.appointment_date, 'dd/MM/yyyy') AS appointment_date,
    FORMAT(c.consultation_date, 'dd/MM/yyyy HH:mm') AS consultation_date,
    
    -- Diagnosis
    ISNULL(c.diagnosis, 'Diagnosis pending') AS diagnosis,
    
    -- Vital Signs (if available)
    CASE WHEN c.blood_pressure IS NOT NULL THEN c.blood_pressure ELSE 'N/A' END AS blood_pressure,
    CASE WHEN c.temperature IS NOT NULL THEN CONCAT(c.temperature, '°F') ELSE 'N/A' END AS temperature,
    CASE WHEN c.oxygen_saturation IS NOT NULL THEN CONCAT(c.oxygen_saturation, '%') ELSE 'N/A' END AS oxygen_saturation
    
FROM consultations c
INNER JOIN appointments a ON c.appointment_id = a.appointment_id
INNER JOIN patients p ON c.patient_id = p.patient_id
INNER JOIN doctors d ON c.doctor_id = d.doctor_id
INNER JOIN specializations s ON d.specialization_id = s.specialization_id
WHERE a.status_id = 2;  -- Only completed appointments




ALTER TABLE rooms
ADD is_occupied BIT NOT NULL DEFAULT 0;

select * from discharges